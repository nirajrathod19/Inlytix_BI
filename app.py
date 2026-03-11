import os
import pandas as pd
from flask import Flask, render_template, request, redirect, url_for, flash, session, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, SubmitField
from wtforms.validators import DataRequired, Email, EqualTo, ValidationError
from fpdf import FPDF
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
import json
from datetime import datetime, timedelta
from flask import send_file
import io
import time
import random
from sklearn.linear_model import LinearRegression
import numpy as np
import re

# This is a placeholder for AI function.
def generate_sql_from_text(user_query):
    """
    Uses AI to convert a natural language query into SQL.
    This is a simplified example.
    """
    # A real implementation would involve sending the user_query and table schemas
    # to a model like Gemini.
    if "total revenue" in user_query and "each product" in user_query:
        return "SELECT product_name, SUM(revenue) AS total_revenue FROM sales GROUP BY product_name;"
    elif "count of customers" in user_query and "each city" in user_query:
        return "SELECT city, COUNT(customer_id) AS customer_count FROM customers GROUP BY city;"
    else:
        return "-- AI could not generate query. Please write it manually."

# --- App Configuration ---
app = Flask(__name__)
# Load secret key from environment variable for better security
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'a_very_secret_key_that_is_hard_to_guess')
app.config['UPLOAD_FOLDER'] = 'uploads'

# Use Flask's instance folder for the database for reliability
instance_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'instance')
if not os.path.exists(instance_path):
    os.makedirs(instance_path)

# Use Supabase PostgreSQL if available, otherwise fall back to SQLite
def _build_db_uri():
    url = os.environ.get('SUPABASE_DATABASE_URL', '').strip()
    if not url:
        return f'sqlite:///{os.path.join(instance_path, "users.db")}'
    # Fix postgres:// → postgresql:// for SQLAlchemy 2.x
    if url.startswith('postgres://'):
        url = 'postgresql://' + url[len('postgres://'):]
    # Validate it looks like a proper URI before using
    if url.startswith('postgresql://') or url.startswith('postgresql+'):
        return url
    # Unrecognised format – fall back to SQLite
    prefix = url[:30] if len(url) >= 30 else url
    print(f"WARNING: SUPABASE_DATABASE_URL has unexpected format (starts with: '{prefix}...'), falling back to SQLite.")
    print("Tip: Supabase connection string should start with 'postgresql://' or 'postgres://'")
    return f'sqlite:///{os.path.join(instance_path, "users.db")}'

app.config['SQLALCHEMY_DATABASE_URI'] = _build_db_uri()
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False


# --- Database Setup ---
db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False)
    email = db.Column(db.String(150), unique=True, nullable=False)
    password = db.Column(db.String(150), nullable=False)
    projects = db.relationship('Project', backref='user', lazy=True)

class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    project_data = db.Column(db.Text, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    last_modified = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

class UserActivity(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    action = db.Column(db.String(100), nullable=False) # e.g., 'login', 'load_project'
    project_name = db.Column(db.String(100), nullable=True) # Name of project, if applicable
    timestamp = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

class StoryPoint(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    insights = db.Column(db.Text, nullable=True)
    chart_config = db.Column(db.Text, nullable=False) # Stores chart type, axes etc. as JSON
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

def log_activity(action, project_name=None):
    if current_user.is_authenticated:
        activity = UserActivity(
            action=action,
            project_name=project_name,
            user_id=current_user.id
        )
        db.session.add(activity)
        db.session.commit()

# --- Forms ---
class RegistrationForm(FlaskForm):
    username = StringField('Username', validators=[DataRequired()])
    email = StringField('Email', validators=[DataRequired(), Email()])
    password = PasswordField('Password', validators=[DataRequired()])
    confirm_password = PasswordField('Confirm Password', validators=[DataRequired(), EqualTo('password')])
    submit = SubmitField('Register')

    def validate_username(self, username):
        user = User.query.filter_by(username=username.data).first()
        if user:
            raise ValidationError('That username is taken. Please choose a different one.')

    def validate_email(self, email):
        user = User.query.filter_by(email=email.data).first()
        if user:
            raise ValidationError('That email is taken. Please choose a different one.')

class LoginForm(FlaskForm):
    email = StringField('Email', validators=[DataRequired(), Email()])
    password = PasswordField('Password', validators=[DataRequired()])
    submit = SubmitField('Login')

@app.route('/connect')
@login_required
def connect_db():
    return render_template('connect_db.html')

@app.route('/export/pdf', methods=['POST'])
@login_required
def export_pdf():
    # Get data from the client
    data = request.get_json()
    chart_config = data.get('chart_config')
    insights_text = data.get('insights')
    title = data.get('title', 'My Report')

    # Get the dataframe from the session
    df_json = session.get('dataframe')
    if not df_json:
        return jsonify({'error': 'No data in session to generate report.'}), 400
    
    df = pd.read_json(df_json)

    # --- Recreate the data table for the report ---
    try:
        x_axis = chart_config.get('x_axis')
        y_axis = chart_config.get('y_axis')
        
        df[y_axis] = pd.to_numeric(df[y_axis], errors='coerce').fillna(0)
        
        report_df = df.groupby(x_axis)[y_axis].sum().reset_index()
        report_df = report_df.sort_values(by=y_axis, ascending=False)
        report_df[y_axis] = report_df[y_axis].apply(lambda x: f"{x:,.2f}")

    except Exception as e:
        print(f"Error processing data for PDF: {e}")
        return jsonify({'error': 'Could not process data for the report.'}), 500

    # --- Generate the PDF ---
    pdf = FPDF()
    pdf.add_page()

    # Title
    pdf.set_font('Arial', 'B', 16)
    pdf.cell(0, 10, title, 0, 1, 'C')
    pdf.ln(10)

    # Insights
    pdf.set_font('Arial', 'B', 12)
    pdf.cell(0, 10, 'Key Insights', 0, 1)
    pdf.set_font('Arial', '', 10)
    pdf.multi_cell(0, 5, insights_text)
    pdf.ln(10)

    # Data Table
    pdf.set_font('Arial', 'B', 12)
    pdf.cell(0, 10, 'Underlying Data', 0, 1)
    pdf.set_font('Arial', '', 10)
    
    # Table Header
    pdf.set_fill_color(230, 230, 230)
    pdf.cell(95, 10, x_axis, 1, 0, 'C', 1)
    pdf.cell(95, 10, y_axis, 1, 1, 'C', 1)

    # Table Rows
    for index, row in report_df.head(20).iterrows(): # Limit to top 20 rows for PDF
        pdf.cell(95, 10, str(row[x_axis]), 1, 0)
        pdf.cell(95, 10, str(row[y_axis]), 1, 1, 'R')

    # --- Send the PDF to the user ---
    buffer = io.BytesIO()
    pdf.output(buffer)
    buffer.seek(0)

    return send_file(
        buffer,
        as_attachment=True,
        download_name=f'{title.replace(" ", "_")}_Report.pdf',
        mimetype='application/pdf'
    )

@app.route('/generate-sql', methods=['POST'])
@login_required
def generate_sql():
    data = request.get_json()
    user_query = data.get('query')
    
    # In a real app, you might also pass table schema information here
    generated_sql = generate_sql_from_text(user_query)
    
    return jsonify({'sql_query': generated_sql})

@app.route('/data/from_db', methods=['POST'])
@login_required
def data_from_db():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Invalid request. No data received.'}), 400
    
    # Get all connection details from the request
    user = data.get('user')
    password = data.get('password')
    host = data.get('host')
    dbname = data.get('name')
    query = data.get('query')

    if not all([user, password, host, dbname, query]):
        return jsonify({'error': 'Missing connection details or query.'}), 400

    db_uri = f"postgresql+psycopg2://{user}:{password}@{host}/{dbname}"

    # --- DIAGNOSTIC PRINT ---
    # Print a safe version of the URI to your terminal to help debug.
    safe_uri = f"postgresql+psycopg2://{user}:****@{host}/{dbname}"
    print(f"--- Attempting to connect to: {safe_uri} ---")

    try:
        engine = create_engine(db_uri)
        with engine.connect() as connection:
            print("--- Connection to database successful. ---")
            df = pd.read_sql_query(text(query), connection)
            print(f"--- Query executed successfully, fetched {len(df)} rows. ---")
        
        session['dataframe'] = df.to_json()
        return jsonify({'success': True})

    except ImportError:
        print("--- IMPORT ERROR: The 'psycopg2' library is likely not installed correctly. ---")
        return jsonify({'error': "Database driver 'psycopg2' not found. Please run 'pip install psycopg2-binary'."}), 500
    except OperationalError as e:
        print(f"--- DATABASE OPERATIONAL ERROR: {e} ---")
        return jsonify({'error': 'Connection failed. Please check your host, database name, username, and password.'}), 500
    except Exception as e:
        print(f"--- AN UNEXPECTED ERROR OCCURRED: {e} ---")
        # This could be a syntax error in the SQL query itself.
        return jsonify({'error': f'An error occurred: {e}'}), 500

@app.after_request
def add_header(response):
    """
    Adds headers to every response to prevent caching of secure pages.
    """
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response
    
# --- Routes ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    form = RegistrationForm()
    if form.validate_on_submit():
        # Use a more secure password hashing method
        hashed_password = generate_password_hash(form.password.data)
        new_user = User(username=form.username.data, email=form.email.data, password=hashed_password)
        db.session.add(new_user)
        db.session.commit()
        flash('Your account has been created! You are now able to log in', 'success')
        return redirect(url_for('login'))
    return render_template('register.html', form=form)

@app.route('/login', methods=['GET', 'POST'])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user and check_password_hash(user.password, form.password.data):
            login_user(user)
            log_activity('login') # Log user login
            return redirect(url_for('dashboard'))
        else:
            flash('Login Unsuccessful. Please check email and password', 'danger')
    return render_template('login.html', form=form)

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))
    
@app.route('/dashboard')
@login_required
def dashboard():
    # Fetch all projects for the main panel
    projects = Project.query.filter_by(user_id=current_user.id).order_by(Project.last_modified.desc()).all()

    # --- Data for Snapshot Panel ---
    last_activity = UserActivity.query.filter_by(user_id=current_user.id, action='load_project') \
                                     .order_by(UserActivity.timestamp.desc()).first()
    
    last_analyzed_project = last_activity.project_name if last_activity else "None"

    # --- Data for Account Info Panel ---
    project_count = len(projects)
    # Placeholder for storage - this is complex to calculate accurately with JSON text fields
    # We'll represent it as a fixed value for now.
    storage_used_mb = project_count * 15 # Estimate 15MB per project
    storage_total_mb = 1024 # 1 GB

    dashboard_data = {
        "last_analyzed": last_analyzed_project,
        "project_count": project_count,
        "storage_used": storage_used_mb,
        "storage_total": storage_total_mb,
        "storage_percent": min(100, (storage_used_mb / storage_total_mb) * 100)
    }

    return render_template('dashboard.html', name=current_user.username, projects=projects, data=dashboard_data)

@app.route('/tutorial/excel')
@login_required
def tutorial_excel():
    return render_template('tutorial_excel.html')

@app.route('/tutorial/chart')
@login_required
def tutorial_chart():
    return render_template('tutorial_chart.html')

@app.route('/tutorial/sql')
@login_required
def tutorial_sql():
    return render_template('tutorial_sql.html')

@app.route('/projects/list')
@login_required
def list_projects():
    projects = Project.query.filter_by(user_id=current_user.id).order_by(Project.last_modified.desc()).all()
    project_list = [{"id": p.id, "name": p.name} for p in projects]
    return jsonify(project_list)

@app.route('/project/save', methods=['POST'])
@login_required
def save_project():
    df_json = session.get('dataframe')
    if not df_json:
        return jsonify({'error': 'No data in session to save.'}), 400

    data = request.get_json()
    project_name = data.get('name')
    action = data.get('action', 'check') # Default action is to check for existence

    if not project_name:
        return jsonify({'error': 'Project name is required.'}), 400

    existing_project = Project.query.filter_by(name=project_name, user_id=current_user.id).first()

    # Action 1: Just check if the project name exists
    if action == 'check':
        return jsonify({'exists': bool(existing_project)})

    # Action 2: Overwrite the existing project
    elif action == 'overwrite':
        if existing_project:
            existing_project.project_data = df_json
            # The 'onupdate' in the model will automatically handle the timestamp here
            db.session.commit()
            flash(f'Project "{project_name}" has been updated successfully!', 'success')
            return jsonify({'success': True})
        else:
            return jsonify({'error': 'Project not found for overwrite.'}), 404

    # Action 3: Save as a new project, finding a unique name if needed
    elif action == 'save_new':
        final_name = project_name
        # If the name already exists, find a new name like "Project (1)", "Project (2)", etc.
        if existing_project:
            base_name = project_name
            # Find all projects with a similar name to find the next available number
            similar_projects = Project.query.filter(Project.name.like(f'{base_name}%'), user_id=current_user.id).all()
            existing_nums = [0]
            for p in similar_projects:
                # Use regex to find numbers in brackets like (1), (23), etc.
                match = re.search(r'\((\d+)\)$', p.name)
                if p.name == base_name and not match: # The base name itself exists
                    existing_nums.append(0)
                if match:
                    existing_nums.append(int(match.group(1)))
            
            next_num = max(existing_nums) + 1
            final_name = f"{base_name} ({next_num})"

        # The 'default' in the model will automatically set the timestamp here
        new_project = Project(name=final_name, project_data=df_json, user_id=current_user.id)
        db.session.add(new_project)
        db.session.commit()
        flash(f'Project "{final_name}" saved successfully!', 'success')
        return jsonify({'success': True})

    return jsonify({'error': 'Invalid action specified.'}), 400

@app.route('/get-forecast-data', methods=['POST'])
@login_required
def get_forecast_data():
    df_json = session.get('dataframe')
    if not df_json:
        return jsonify({'error': 'No data in session.'}), 400

    config = request.get_json()
    x_axis = config.get('x_axis')
    y_axis = config.get('y_axis')
    periods = int(config.get('periods', 5))

    try:
        df = pd.read_json(df_json)
        df[y_axis] = pd.to_numeric(df[y_axis], errors='coerce').fillna(0)
        
        # Aggregate the data first, similar to get_chart_data
        chart_data_df = df.groupby(x_axis)[y_axis].sum().reset_index()

        # Prepare data for linear regression
        X = np.arange(len(chart_data_df)).reshape(-1, 1)
        y = chart_data_df[y_axis].values

        # Train the model
        model = LinearRegression()
        model.fit(X, y)

        # Predict future values
        future_X = np.arange(len(chart_data_df), len(chart_data_df) + periods).reshape(-1, 1)
        future_y = model.predict(future_X)

        # Create labels for the future periods
        last_label = chart_data_df[x_axis].iloc[-1]
        future_labels = []
        try:
            # Attempt to parse the last label as a date
            last_date = pd.to_datetime(last_label)
            # Generate future date labels
            future_dates = pd.date_range(start=last_date + timedelta(days=1), periods=periods)
            future_labels = [d.strftime('%Y-%m-%d') for d in future_dates]
        except (ValueError, TypeError):
            # Fallback for non-date or integer labels
            if isinstance(last_label, (int, np.integer)):
                 future_labels = [str(i) for i in range(last_label + 1, last_label + 1 + periods)]
            else:
                future_labels = [f"Future {i+1}" for i in range(periods)]
        
        forecast_data = {
            "labels": future_labels,
            "values": future_y.tolist()
        }
        
        return jsonify(forecast_data)

    except Exception as e:
        print(f"Error during forecast: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/project/load/<int:project_id>')
@login_required
def load_project(project_id):
    project = Project.query.get_or_404(project_id)
    if project.user_id != current_user.id:
        flash('You are not authorized to view this project.', 'danger')
        return redirect(url_for('dashboard'))
    
    session['dataframe'] = project.project_data
    log_activity('load_project', project_name=project.name) # Log project loading
    
    flash(f'Project "{project.name}" loaded successfully.', 'success')
    return redirect(url_for('chart_builder'))

@app.route('/project/delete/<int:project_id>', methods=['POST'])
@login_required
def delete_project(project_id):
    project = Project.query.get_or_404(project_id)

    # Security check: ensure the user owns this project
    if project.user_id != current_user.id:
        flash('You are not authorized to delete this project.', 'danger')
        return redirect(url_for('dashboard'))
    
    try:
        db.session.delete(project)
        db.session.commit()
        flash(f'Project "{project.name}" has been deleted.', 'success')
    except Exception as e:
        db.session.rollback()
        flash(f'Error deleting project: {e}', 'danger')
        
    return redirect(url_for('dashboard'))

@app.route('/upload', methods=['GET', 'POST'])
@login_required
def upload():
    if request.method == 'POST':
        files = request.files.getlist('files')
        
        # Filter out empty file objects that might be submitted
        files = [f for f in files if f.filename]

        if not files:
            flash('No files selected', 'danger')
            return redirect(request.url)

        def _read_file(file):
            fn = file.filename.lower()
            if fn.endswith('.csv'):
                return pd.read_csv(file)
            elif fn.endswith(('.xls', '.xlsx')):
                return pd.read_excel(file)
            elif fn.endswith('.json'):
                return pd.read_json(file)
            elif fn.endswith(('.tsv', '.txt')):
                return pd.read_csv(file, sep='\t')
            elif fn.endswith('.parquet'):
                return pd.read_parquet(file)
            else:
                return None

        try:
            # Case 1: A single file was uploaded
            if len(files) == 1:
                file = files[0]
                df = _read_file(file)
                if df is None:
                    flash('Unsupported file type. Supported: CSV, Excel, JSON, TSV, TXT, Parquet.', 'danger')
                    return redirect(request.url)
                flash(f'Loaded {len(df):,} rows from {file.filename}', 'success')
                session['dataframe'] = df.to_json()
                return redirect(url_for('prepare_data'))

            # Case 2: Multiple files were uploaded
            else:
                flash(f'Processing {len(files)} files for modeling.', 'info')
                uploaded_data = {}
                for file in files:
                    filename = file.filename
                    df = _read_file(file)
                    if df is None:
                        continue
                    
                    uploaded_data[filename] = df.to_json()
                
                # For multiple files, go to the modeling step
                session['uploaded_data'] = uploaded_data
                return redirect(url_for('model_data'))

        except Exception as e:
            flash(f'Error processing file(s): {e}', 'danger')
            return redirect(request.url)

    # This is for the GET request (just showing the page)
    return render_template('upload.html')


def detect_join_keys(table_columns):
    """Auto-detect potential join keys (shared column names) between tables."""
    suggestions = []
    table_names = list(table_columns.keys())
    for i in range(len(table_names)):
        for j in range(i + 1, len(table_names)):
            t1, t2 = table_names[i], table_names[j]
            common_cols = set(table_columns[t1]) & set(table_columns[t2])
            for col in common_cols:
                suggestions.append({'left_table': t1, 'right_table': t2, 'key': col})
    return suggestions


@app.route('/model')
@login_required
def model_data():
    uploaded_data = session.get('uploaded_data')
    if not uploaded_data:
        return redirect(url_for('upload'))

    table_names = list(uploaded_data.keys())
    table_columns = {}
    for name, df_json in uploaded_data.items():
        df = pd.read_json(df_json)
        table_columns[name] = df.columns.tolist()

    auto_suggestions = detect_join_keys(table_columns)

    return render_template('model.html', tables=table_names, table_columns=table_columns,
                           auto_suggestions=auto_suggestions)


@app.route('/data/merge', methods=['POST'])
@login_required
def merge_data():
    uploaded_data = session.get('uploaded_data')
    if not uploaded_data:
        return redirect(url_for('upload'))

    # Get merge parameters from the form
    left_table_name = request.form.get('left_table')
    right_table_name = request.form.get('right_table')
    left_key = request.form.get('left_key')
    right_key = request.form.get('right_key')
    join_type = request.form.get('join_type')

    # Load dataframes from session
    df_left = pd.read_json(uploaded_data[left_table_name])
    df_right = pd.read_json(uploaded_data[right_table_name])

    try:
        df_left[left_key] = df_left[left_key].astype(str)
        df_right[right_key] = df_right[right_key].astype(str)

        # Perform the merge
        merged_df = pd.merge(
            df_left, 
            df_right, 
            left_on=left_key, 
            right_on=right_key, 
            how=join_type
        )
        
        # Save the final merged dataframe for the 'prepare' step
        session['dataframe'] = merged_df.to_json()
        flash('Tables merged successfully!', 'success')
        return redirect(url_for('prepare_data'))

    except Exception as e:
        flash(f'Error during merge: {e}', 'danger')
        return redirect(url_for('model_data'))

@app.route('/prepare')
@login_required
def prepare_data():
    # Get the dataframe from the session (this works for single or merged files)
    df_json = session.get('dataframe')
    if not df_json:
        flash('No data to prepare. Please upload a file first.', 'danger')
        return redirect(url_for('upload'))
    
    try:
        df = pd.read_json(df_json)
        
        # Get column lists for the template's forms
        columns = df.columns.tolist()
        numeric_columns = df.select_dtypes(include=['number']).columns.tolist()

        return render_template(
            'prepare.html', 
            dataframe_html=df.head(20).to_html(classes='table table-sm', index=False),
            columns=columns,
            numeric_columns=numeric_columns
        )
    except Exception as e:
        flash(f'Error displaying data for preparation: {e}', 'danger')
        return redirect(url_for('upload'))

@app.route('/data/action', methods=['POST'])
@login_required
def handle_data_action():
    df_json = session.get('dataframe')
    if not df_json:
        return redirect(url_for('upload'))
    
    df = pd.read_json(df_json)
    action = request.form.get('action')

    if action == 'remove_column':
        col_to_remove = request.form.get('column_to_remove')
        if col_to_remove in df.columns:
            df = df.drop(columns=[col_to_remove])
            flash(f'Column "{col_to_remove}" removed.', 'success')

    elif action == 'fill_na':
        col_to_fill = request.form.get('column_to_fill')
        fill_value = request.form.get('fill_value')
        
        # Try to convert fill_value to numeric if the column is numeric
        if pd.api.types.is_numeric_dtype(df[col_to_fill]):
            try:
                fill_value = float(fill_value)
            except ValueError:
                flash('Fill value must be a number for numeric columns.', 'danger')
                return redirect(url_for('prepare_data'))

        df[col_to_fill] = df[col_to_fill].fillna(fill_value)
        flash(f'Missing values in "{col_to_fill}" filled with {fill_value}.', 'success')

    elif action == 'create_calculated_column':
        new_col_name = request.form.get('new_col_name')
        op1_name = request.form.get('operand1')
        op2_name = request.form.get('operand2')
        operator = request.form.get('operator')

        try:
            # Ensure columns are numeric before calculation
            op1 = pd.to_numeric(df[op1_name])
            op2 = pd.to_numeric(df[op2_name])

            if operator == '+':
                df[new_col_name] = op1 + op2
            elif operator == '-':
                df[new_col_name] = op1 - op2
            elif operator == '*':
                df[new_col_name] = op1 * op2
            elif operator == '/':
                # Avoid division by zero, replace with 0
                df[new_col_name] = (op1 / op2).fillna(0).replace([float('inf'), -float('inf')], 0)
            
            flash(f'New column "{new_col_name}" created successfully.', 'success')
        except Exception as e:
            flash(f'Could not create column: {e}', 'danger')
            
    # Save the transformed dataframe back to the session
    session['dataframe'] = df.to_json()
    return redirect(url_for('prepare_data'))

@app.route('/ai-insights', methods=['POST'])
@login_required
def get_ai_insights():
    # Simulate a delay to mimic a real AI API call
    time.sleep(2) 

    data = request.get_json()
    chart_config = data.get('chart_config')
    x_axis = chart_config.get('x_axis')
    y_axis = chart_config.get('y_axis')

    # Get the dataframe from the session
    df_json = session.get('dataframe')
    if not df_json:
        return jsonify({'error': 'No data in session to analyze.'}), 400
    
    df = pd.read_json(df_json)

    # --- This is where you would normally prepare data and call an LLM API ---
    # For now, we will generate a simulated, dynamic response.
    try:
        report_df = df.groupby(x_axis)[y_axis].sum().reset_index()
        top_item = report_df.loc[report_df[y_axis].idxmax()]
        bottom_item = report_df.loc[report_df[y_axis].idxmin()]
        average_val = report_df[y_axis].mean()

        # Simulated AI Responses
        responses = [
            f"The analysis of '{y_axis}' by '{x_axis}' reveals a significant trend. The highest value is observed in '{top_item[x_axis]}' with a total of {top_item[y_axis]:,.2f}, which is substantially above the average of {average_val:,.2f}.\\n\\nConversely, '{bottom_item[x_axis]}' shows the lowest performance at {bottom_item[y_axis]:,.2f}. This disparity suggests a key area for potential investigation or improvement.",
            f"Looking at the distribution of '{y_axis}' across '{x_axis}', it's clear that '{top_item[x_axis]}' is the top performer, contributing {top_item[y_axis]:,.2f}.\\n\\nOn the other end of the spectrum is '{bottom_item[x_axis]}'. It would be beneficial to explore the factors driving the success of '{top_item[x_axis]}' and apply those learnings elsewhere.",
            f"A key insight from this data is the standout performance of '{top_item[x_axis]}', which recorded a '{y_axis}' of {top_item[y_axis]:,.2f}.\\n\\nThis is a major outlier when compared to the lowest value from '{bottom_item[x_axis]}'. The data suggests a strong concentration of '{y_axis}' in the top category."
        ]
        
        ai_summary = random.choice(responses)

        return jsonify({'insights': ai_summary})

    except Exception as e:
        print(f"Error in AI insights generation: {e}")
        return jsonify({'error': 'Could not generate AI insights from the data.'}), 500

@app.route('/chart-builder')
@login_required
def chart_builder():
    # Get the prepared dataframe from the session
    df_json = session.get('dataframe')
    if not df_json:
        flash('Please upload a file first.', 'warning')
        return redirect(url_for('upload'))

    # Load the dataframe and get all column lists needed for the dropdowns
    df = pd.read_json(df_json)
    columns = df.columns.tolist()
    numeric_cols = df.select_dtypes(include=['number']).columns.tolist()
    categorical_cols = df.select_dtypes(include=['object', 'category']).columns.tolist()
    
    # Load user's story points
    story_points = StoryPoint.query.filter_by(user_id=current_user.id).all()

    return render_template(
        'chart_builder.html', 
        columns=columns,
        numeric_cols=numeric_cols,
        categorical_cols=categorical_cols,
        story_points=story_points
    )

@app.route('/story/add', methods=['POST'])
@login_required
def add_story_point():
    data = request.get_json()
    title = data.get('title')
    insights = data.get('insights')
    config = data.get('config') # This will be a JSON string of the chart settings

    if not title or not config:
        return jsonify({'error': 'Title and config are required.'}), 400

    new_point = StoryPoint(
        title=title,
        insights=insights,
        chart_config=json.dumps(config), # Store config as a JSON string
        user_id=current_user.id
    )
    db.session.add(new_point)
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'Story point added!'})

@app.route('/story/load/<int:point_id>')
@login_required
def load_story_point_data(point_id):
    point = StoryPoint.query.get_or_404(point_id)
    if point.user_id != current_user.id:
        return jsonify({'error': 'Unauthorized'}), 403
    
    # The config is stored as a string, so we need to load it back into a dict
    config = json.loads(point.chart_config)
    
    return jsonify({
        'title': point.title,
        'insights': point.insights,
        'config': config
    })

@app.route('/get-chart-data', methods=['POST'])
@login_required
def get_chart_data():
    """
    This function processes data from the session to generate chart-ready data.
    It handles two main cases:
    1. Scatter plots: Returns raw (x, y) coordinates for two numeric columns.
    2. Aggregated charts (bar, line, pie): Returns summarized data (e.g., sum of sales per category).
    It also accepts an optional filter to support interactive drill-downs.
    """
    df_json = session.get('dataframe') 
    if not df_json:
        return jsonify({'error': 'No data found in session. Please upload a file.'}), 400
    
    df = pd.read_json(df_json)
    chart_config = request.get_json()
    x_axis      = chart_config.get('x_axis')
    y_axis      = chart_config.get('y_axis')
    size_col    = chart_config.get('size_col')
    chart_type  = chart_config.get('chart_type')
    agg_func    = chart_config.get('aggregation', 'sum')
    top_n       = int(chart_config.get('top_n', 0) or 0)

    # Normalise aggregation
    AGG_MAP = {'sum': 'sum', 'mean': 'mean', 'count': 'count', 'max': 'max', 'min': 'min'}
    agg_func = AGG_MAP.get(agg_func, 'sum')

    # Handle incoming filters for interactive drill-down
    filter_col = chart_config.get('filter_col')
    filter_val = chart_config.get('filter_val')
    if filter_col and filter_val is not None and filter_col in df.columns:
        try:
            col_dtype = df[filter_col].dtype
            typed_filter_val = pd.Series([filter_val]).astype(col_dtype).iloc[0]
            df = df[df[filter_col] == typed_filter_val]
        except (ValueError, TypeError):
            df = df[df[filter_col].astype(str) == str(filter_val)]

    try:
        if chart_type == 'table':
            df[y_axis] = pd.to_numeric(df[y_axis], errors='coerce').fillna(0)
            table_df = df.groupby(x_axis)[y_axis].agg(agg_func).reset_index()
            chart_data = table_df.to_html(classes='table table-hover', index=False)
            response_data = {"chart_data": chart_data, "insights": {"Rows": len(table_df)},
                             "labels": table_df[x_axis].astype(str).tolist(),
                             "values": table_df[y_axis].round(4).tolist()}

        elif chart_type == 'treemap':
            df[y_axis] = pd.to_numeric(df[y_axis], errors='coerce').fillna(0)
            tree_df = df.groupby(x_axis)[y_axis].agg(agg_func).reset_index()
            if top_n > 0:
                tree_df = tree_df.nlargest(top_n, y_axis)
            chart_data = [{"name": str(row[x_axis]), "value": float(row[y_axis])} for _, row in tree_df.iterrows()]
            response_data = {"chart_data": chart_data, "insights": {"Categories": len(tree_df)},
                             "labels": tree_df[x_axis].astype(str).tolist(),
                             "values": tree_df[y_axis].round(4).tolist()}

        elif chart_type == 'scatter':
            df[x_axis] = pd.to_numeric(df[x_axis], errors='coerce')
            df[y_axis] = pd.to_numeric(df[y_axis], errors='coerce')
            scatter_df = df[[x_axis, y_axis]].dropna()
            chart_data = [{'x': row[x_axis], 'y': row[y_axis]} for _, row in scatter_df.iterrows()]
            correlation = scatter_df[x_axis].corr(scatter_df[y_axis]) if not scatter_df.empty else 0
            insights = {
                "Correlation Coefficient": f"{correlation:.4f}",
                "Note": "Near +1 = strong positive, -1 = strong negative, 0 = no correlation."
            }
            response_data = {"chart_data": chart_data, "insights": insights,
                             "labels": scatter_df[x_axis].tolist(),
                             "values": scatter_df[y_axis].tolist()}

        elif chart_type == 'bubble':
            for col in [x_axis, y_axis, size_col]:
                if col and col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce')
            bubble_df = df[[c for c in [x_axis, y_axis, size_col] if c]].dropna()
            s_min = bubble_df[size_col].min() if size_col else 1
            s_max = bubble_df[size_col].max() if size_col else 1
            s_range = (s_max - s_min) or 1
            bubble_data = []
            for _, row in bubble_df.iterrows():
                r = 5 + 35 * (row[size_col] - s_min) / s_range if size_col else 10
                bubble_data.append({'x': row[x_axis], 'y': row[y_axis], 'r': round(r, 1)})
            response_data = {"chart_data": bubble_data, "bubble_data": bubble_data,
                             "labels": bubble_df[x_axis].astype(str).tolist(),
                             "values": bubble_df[y_axis].tolist(),
                             "insights": {"Points": len(bubble_data)}}

        else:
            # Aggregated charts – bar, line, pie, doughnut, radar, polarArea, histogram
            if not x_axis or x_axis not in df.columns:
                return jsonify({'error': f'Column "{x_axis}" not found.'}), 400

            if chart_type == 'histogram':
                df[x_axis] = pd.to_numeric(df[x_axis], errors='coerce').dropna()
                counts, edges = np.histogram(df[x_axis].dropna(), bins=20)
                labels  = [f"{edges[i]:.1f}–{edges[i+1]:.1f}" for i in range(len(counts))]
                values  = counts.tolist()
                chart_data_df = None
            else:
                df[y_axis] = pd.to_numeric(df[y_axis], errors='coerce').fillna(0)
                if df.empty or y_axis not in df.columns:
                    return jsonify({'chart_data': [], 'labels': [], 'values': [],
                                    'insights': {'Message': 'No data for this selection.'}})
                chart_data_df = df.groupby(x_axis)[y_axis].agg(agg_func).reset_index()
                chart_data_df.columns = ['key', 'value']
                chart_data_df = chart_data_df.sort_values('value', ascending=False)
                if top_n > 0:
                    chart_data_df = chart_data_df.head(top_n)
                labels = chart_data_df['key'].astype(str).tolist()
                values = chart_data_df['value'].round(4).tolist()

            if chart_data_df is not None:
                total_value    = chart_data_df['value'].sum()
                average_value  = chart_data_df['value'].mean()
                max_item       = chart_data_df.loc[chart_data_df['value'].idxmax()]
                min_item       = chart_data_df.loc[chart_data_df['value'].idxmin()]
                insights = {
                    "Total":   f"{total_value:,.2f}",
                    "Average": f"{average_value:,.2f}",
                    f"Highest ({max_item['key']})": f"{max_item['value']:,.2f}",
                    f"Lowest ({min_item['key']})":  f"{min_item['value']:,.2f}",
                    "Categories": str(chart_data_df['key'].nunique()),
                }
                chart_data = chart_data_df.rename(columns={'key': x_axis, 'value': y_axis}).to_dict(orient='records')
            else:
                insights   = {"Bins": len(labels)}
                chart_data = [{'key': l, 'value': v} for l, v in zip(labels, values)]

            response_data = {
                "chart_data": chart_data,
                "labels":     labels,
                "values":     values,
                "insights":   insights,
            }

        return jsonify(response_data)

    except Exception as e:
        print(f"Error in get-chart-data: {e}") 
        return jsonify({'error': str(e)}), 500


# ─── Smart Clean ──────────────────────────────────────────────────────────────
@app.route('/smart-clean', methods=['POST'])
@login_required
def smart_clean():
    df_json = session.get('dataframe')
    if not df_json:
        return jsonify({'error': 'No data in session.'}), 400

    df = pd.read_json(df_json)
    report = []

    # 1. Remove duplicates
    dup_count = int(df.duplicated().sum())
    if dup_count > 0:
        df = df.drop_duplicates()
        report.append(f"Removed {dup_count} duplicate row(s).")

    # 2. Impute missing values
    for col in df.columns:
        missing = int(df[col].isnull().sum())
        if missing > 0:
            if pd.api.types.is_numeric_dtype(df[col]):
                fill_val = round(float(df[col].mean()), 4)
                df[col] = df[col].fillna(fill_val)
                report.append(f"Filled {missing} missing value(s) in <strong>{col}</strong> with mean ({fill_val}).")
            else:
                mode_vals = df[col].mode()
                fill_val = str(mode_vals.iloc[0]) if not mode_vals.empty else 'Unknown'
                df[col] = df[col].fillna(fill_val)
                report.append(f"Filled {missing} missing value(s) in <strong>{col}</strong> with mode ('{fill_val}').")

    # 3. Standardize date columns to YYYY-MM-DD
    for col in df.select_dtypes(include='object').columns:
        try:
            converted = pd.to_datetime(df[col], infer_datetime_format=True, errors='coerce')
            if converted.notna().sum() > len(df) * 0.5:
                df[col] = converted.dt.strftime('%Y-%m-%d')
                report.append(f"Standardized date column <strong>{col}</strong> to YYYY-MM-DD.")
        except Exception:
            pass

    # 4. Detect outliers (IQR) – store indices for front-end highlighting
    outlier_map = {}
    for col in df.select_dtypes(include='number').columns:
        Q1, Q3 = df[col].quantile(0.25), df[col].quantile(0.75)
        IQR = Q3 - Q1
        if IQR == 0:
            continue
        mask = (df[col] < Q1 - 1.5 * IQR) | (df[col] > Q3 + 1.5 * IQR)
        idxs = df.index[mask].tolist()
        if idxs:
            outlier_map[col] = idxs
            report.append(f"Detected {len(idxs)} outlier(s) in <strong>{col}</strong> (highlighted in preview).")

    if not report:
        report.append("Data is already clean — no issues found.")

    session['dataframe'] = df.to_json()
    session['outlier_map'] = outlier_map

    # Rebuild preview with outlier highlighting
    styled_rows = []
    for idx, row in df.head(50).iterrows():
        cells = []
        for col in df.columns:
            style = ' style="background:#7f1d1d;color:#fca5a5;"' if col in outlier_map and idx in outlier_map[col] else ''
            cells.append(f'<td{style}>{row[col]}</td>')
        styled_rows.append('<tr>' + ''.join(cells) + '</tr>')

    header = '<tr>' + ''.join(f'<th>{c}</th>' for c in df.columns) + '</tr>'
    table_html = f'<table class="table table-sm table-hover" id="dataPreviewTable"><thead class="table-dark">{header}</thead><tbody>{"".join(styled_rows)}</tbody></table>'

    return jsonify({'success': True, 'report': report, 'table_html': table_html})


# ─── Ask My Data (NL → KPI Card) ──────────────────────────────────────────────
@app.route('/ask-data', methods=['POST'])
@login_required
def ask_data():
    df_json = session.get('dataframe')
    if not df_json:
        return jsonify({'error': 'No data in session.'}), 400

    df = pd.read_json(df_json)
    data = request.get_json()
    query = (data.get('query') or '').lower().strip()

    numeric_cols  = df.select_dtypes(include='number').columns.tolist()
    categorical_cols = df.select_dtypes(include='object').columns.tolist()

    def best_col(cols, query_text):
        for c in cols:
            if c.lower() in query_text:
                return c
        return cols[0] if cols else None

    try:
        top_keywords    = ['top', 'highest', 'best', 'most', 'largest', 'maximum', 'max']
        bottom_keywords = ['lowest', 'worst', 'minimum', 'min', 'least', 'bottom']
        total_keywords  = ['total', 'sum', 'overall', 'revenue', 'sales']
        avg_keywords    = ['average', 'mean', 'avg']
        count_keywords  = ['count', 'how many', 'number of', 'unique']

        if any(w in query for w in top_keywords) and numeric_cols and categorical_cols:
            num_col = best_col(numeric_cols, query)
            cat_col = best_col(categorical_cols, query)
            grouped = df.groupby(cat_col)[num_col].sum()
            label   = grouped.idxmax()
            value   = grouped.max()
            return jsonify({'title': f'Top {cat_col}', 'value': f'{value:,.2f}',
                            'label': str(label), 'icon': 'fa-trophy', 'color': '#f59e0b',
                            'subtitle': f'Highest {num_col} among all {cat_col} entries',
                            'rows': len(df)})

        elif any(w in query for w in bottom_keywords) and numeric_cols and categorical_cols:
            num_col = best_col(numeric_cols, query)
            cat_col = best_col(categorical_cols, query)
            grouped = df.groupby(cat_col)[num_col].sum()
            label   = grouped.idxmin()
            value   = grouped.min()
            return jsonify({'title': f'Bottom {cat_col}', 'value': f'{value:,.2f}',
                            'label': str(label), 'icon': 'fa-arrow-trend-down', 'color': '#ef4444',
                            'subtitle': f'Lowest {num_col} — potential improvement area',
                            'rows': len(df)})

        elif any(w in query for w in total_keywords) and numeric_cols:
            num_col = best_col(numeric_cols, query)
            value   = df[num_col].sum()
            return jsonify({'title': f'Total {num_col}', 'value': f'{value:,.2f}',
                            'label': f'Across {len(df):,} rows', 'icon': 'fa-sigma', 'color': '#3b82f6',
                            'subtitle': f'Grand total of all {num_col} values',
                            'rows': len(df)})

        elif any(w in query for w in avg_keywords) and numeric_cols:
            num_col = best_col(numeric_cols, query)
            value   = df[num_col].mean()
            return jsonify({'title': f'Average {num_col}', 'value': f'{value:,.2f}',
                            'label': f'Over {len(df):,} records', 'icon': 'fa-chart-line', 'color': '#8b5cf6',
                            'subtitle': f'Mean of all {num_col} values',
                            'rows': len(df)})

        elif any(w in query for w in count_keywords) and categorical_cols:
            cat_col = best_col(categorical_cols, query)
            value   = df[cat_col].nunique()
            return jsonify({'title': f'Unique {cat_col}', 'value': str(value),
                            'label': f'Distinct values found', 'icon': 'fa-list-ol', 'color': '#10b981',
                            'subtitle': f'Total rows analysed: {len(df):,}',
                            'rows': len(df)})

        else:
            # Default fallback – show dataset summary
            if numeric_cols:
                num_col = numeric_cols[0]
                value   = df[num_col].sum()
                return jsonify({'title': f'Total {num_col}', 'value': f'{value:,.2f}',
                                'label': 'Based on full dataset', 'icon': 'fa-database', 'color': '#3b82f6',
                                'subtitle': f'Try asking: "Who is my top customer?" or "What is the total revenue?"',
                                'rows': len(df)})
            return jsonify({'error': 'Could not understand the query. Try: "total revenue", "top customer", "average sales".'}), 400

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Executive Narrative ───────────────────────────────────────────────────────
@app.route('/executive-narrative', methods=['POST'])
@login_required
def executive_narrative():
    df_json = session.get('dataframe')
    if not df_json:
        return jsonify({'error': 'No data.'}), 400

    df   = pd.read_json(df_json)
    data = request.get_json()
    x_axis     = data.get('x_axis')
    y_axis     = data.get('y_axis')
    chart_type = data.get('chart_type', 'bar')

    if not x_axis or not y_axis or x_axis not in df.columns or y_axis not in df.columns:
        return jsonify({'error': 'Invalid axes.'}), 400

    try:
        df[y_axis] = pd.to_numeric(df[y_axis], errors='coerce').fillna(0)
        grouped = df.groupby(x_axis)[y_axis].sum().reset_index()

        total     = grouped[y_axis].sum()
        avg       = grouped[y_axis].mean()
        top       = grouped.loc[grouped[y_axis].idxmax()]
        bottom    = grouped.loc[grouped[y_axis].idxmin()]
        top_pct   = (top[y_axis] / total * 100) if total > 0 else 0
        gap_pct   = ((top[y_axis] - bottom[y_axis]) / avg * 100) if avg > 0 else 0
        n_cats    = len(grouped)

        templates = [
            (f"<strong>{top[x_axis]}</strong> leads <em>{y_axis}</em> with "
             f"<strong>{top[y_axis]:,.2f}</strong> ({top_pct:.1f}% of the total {total:,.2f}), "
             f"well above the {n_cats}-category average of {avg:,.2f}. "
             f"<strong>{bottom[x_axis]}</strong> sits at the bottom ({bottom[y_axis]:,.2f}), "
             f"representing a {gap_pct:.0f}% performance gap — a prime candidate for strategic review."),

            (f"Across {n_cats} <em>{x_axis}</em> categories, total <em>{y_axis}</em> reached "
             f"<strong>{total:,.2f}</strong>. The stand-out performer is "
             f"<strong>{top[x_axis]}</strong> at {top[y_axis]:,.2f}, "
             f"while <strong>{bottom[x_axis]}</strong> trails at {bottom[y_axis]:,.2f}. "
             f"Closing this {gap_pct:.0f}% gap could materially lift overall results."),
        ]
        narrative = random.choice(templates)
        return jsonify({'narrative': narrative})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Global Search ─────────────────────────────────────────────────────────────
@app.route('/search')
@login_required
def global_search():
    q = (request.args.get('q') or '').strip().lower()
    if len(q) < 2:
        return jsonify({'results': []})

    results = []

    # Projects
    for p in Project.query.filter_by(user_id=current_user.id).all():
        if q in p.name.lower():
            results.append({'type': 'Project', 'name': p.name,
                            'url': f'/project/load/{p.id}', 'icon': 'fa-folder-open'})

    # Columns in active dataframe
    df_json = session.get('dataframe')
    if df_json:
        try:
            df = pd.read_json(df_json)
            for col in df.columns:
                if q in col.lower():
                    results.append({'type': 'Column', 'name': col,
                                    'url': '/chart-builder', 'icon': 'fa-table-columns'})
        except Exception:
            pass

    return jsonify({'results': results[:12]})


@app.route('/dashboard-builder')
@login_required
def dashboard_builder_view():
    df_json = session.get('dataframe')
    if not df_json:
        flash('Please upload a data file first to use the Dashboard Builder.', 'warning')
        return redirect(url_for('upload'))
    df = pd.read_json(df_json)
    columns = df.columns.tolist()
    numeric_cols = df.select_dtypes(include='number').columns.tolist()
    categorical_cols = df.select_dtypes(include=['object', 'category']).columns.tolist()
    return render_template('dashboard_builder.html',
                           columns=columns,
                           numeric_cols=numeric_cols,
                           categorical_cols=categorical_cols)


# --- Main Execution ---
if __name__ == '__main__':
    # --- START DIAGNOSTIC ---
    print("--- DIAGNOSTICS ---")
    # Use app.root_path, a reliable way to get the app's root directory
    print(f"Project Base Directory: {app.root_path}") 
    print(f"Database URI is: {app.config['SQLALCHEMY_DATABASE_URI']}")
    print("-------------------")
    # --- END DIAGNOSTIC ---
    
    with app.app_context():
        # The instance folder is already handled by the app configuration.
        # We just need to ensure the 'uploads' folder exists.
        upload_folder = os.path.join(app.root_path, app.config['UPLOAD_FOLDER'])
        if not os.path.exists(upload_folder):
            print(f"Uploads folder not found. Creating it at: {upload_folder}")
            os.makedirs(upload_folder)

        # Create the database tables
        db.create_all()
        
    app.run(host='0.0.0.0', port=5000, debug=True)
