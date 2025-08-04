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
import json
from datetime import datetime
import io
from sklearn.linear_model import LinearRegression
import numpy as np
import re

# --- App Configuration ---
app = Flask(__name__)
app.config['SECRET_KEY'] = 'a_very_secret_key_that_is_hard_to_guess'
app.config['UPLOAD_FOLDER'] = 'uploads'

# Use an ABSOLUTE path for the database to avoid pathing issues
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'instance', 'users.db')
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
    projects = db.relationship('Project', backref='author', lazy=True)

class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    # This will store the prepared DataFrame as a large text block (JSON)
    project_data = db.Column(db.Text, nullable=False)
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
        hashed_password = generate_password_hash(form.password.data, method='pbkdf2:sha256')
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
    print(f"--- Loading dashboard for user: {current_user.id} ({current_user.username}) ---")
    projects = Project.query.filter_by(user_id=current_user.id).order_by(Project.name).all()
    print(f"--- Found {len(projects)} project(s) for this user. ---")
    return render_template('dashboard.html', name=current_user.username, projects=projects)

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
        # We need a numeric sequence for the x-values
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

    # Security check: ensure the user owns this project
    if project.user_id != current_user.id:
        flash('You are not authorized to view this project.', 'danger')
        return redirect(url_for('dashboard'))
    
    # Load the project's data into the session
    session['dataframe'] = project.project_data
    
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

        try:
            # Case 1: A single file was uploaded
            if len(files) == 1:
                file = files[0]
                flash(f'Processing single file: {file.filename}', 'info')
                if file.filename.endswith('.csv'):
                    df = pd.read_csv(file)
                elif file.filename.endswith(('.xls', '.xlsx')):
                    df = pd.read_excel(file)
                else:
                    flash('Unsupported file type for single upload.', 'danger')
                    return redirect(request.url)
                
                # For a single file, save the dataframe and go straight to the prepare step
                session['dataframe'] = df.to_json()
                return redirect(url_for('prepare_data'))

            # Case 2: Multiple files were uploaded
            else:
                flash(f'Processing {len(files)} files for modeling.', 'info')
                uploaded_data = {}
                for file in files:
                    filename = file.filename
                    if filename.endswith('.csv'):
                        df = pd.read_csv(file)
                    elif filename.endswith(('.xls', '.xlsx')):
                        df = pd.read_excel(file)
                    else:
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


@app.route('/model')
@login_required
def model_data():
    uploaded_data = session.get('uploaded_data')
    if not uploaded_data:
        return redirect(url_for('upload'))

    table_names = list(uploaded_data.keys())
    
    # Create a dictionary of table_name: [col1, col2, ...] for the dynamic dropdowns
    table_columns = {}
    for name, df_json in uploaded_data.items():
        df = pd.read_json(df_json)
        table_columns[name] = df.columns.tolist()

    return render_template('model.html', tables=table_names, table_columns=table_columns)


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
    x_axis = chart_config.get('x_axis')
    y_axis = chart_config.get('y_axis')
    chart_type = chart_config.get('chart_type')

    # Handle incoming filters for interactive drill-down
    filter_col = chart_config.get('filter_col')
    filter_val = chart_config.get('filter_val')
    if filter_col and filter_val is not None:
        # Robustly filter by attempting to match data types.
        try:
            # Get the data type of the column we are filtering on.
            col_dtype = df[filter_col].dtype
            # Convert the filter value to the same type.
            typed_filter_val = pd.Series([filter_val]).astype(col_dtype).iloc[0]
            df = df[df[filter_col] == typed_filter_val]
        except (ValueError, TypeError):
             # If type conversion fails, fall back to string comparison.
            df = df[df[filter_col].astype(str) == str(filter_val)]

    try:
        # Conditional logic based on chart type
        if chart_type == 'scatter':
            # For scatter plots, we need two numeric columns without aggregation.
            df[x_axis] = pd.to_numeric(df[x_axis], errors='coerce')
            df[y_axis] = pd.to_numeric(df[y_axis], errors='coerce')
            
            # Drop rows where either axis is not a number.
            scatter_df = df[[x_axis, y_axis]].dropna()
            
            # Format data as an array of {x, y} objects for Chart.js.
            chart_data = [{'x': row[x_axis], 'y': row[y_axis]} for index, row in scatter_df.iterrows()]
            
            # Calculate correlation as an insight, handle case with no data.
            correlation = scatter_df[x_axis].corr(scatter_df[y_axis]) if not scatter_df.empty else 0
            insights = {
                "Correlation Coefficient": f"{correlation:.4f}",
                "Note": "A value near +1 indicates a strong positive correlation, -1 a strong negative, and 0 no correlation."
            }
            response_data = {"chart_data": chart_data, "insights": insights}

        else:
            # --- Existing logic for aggregated charts (bar, line, pie) ---
            df[y_axis] = pd.to_numeric(df[y_axis], errors='coerce').fillna(0)

            # Check if there's any data left after filtering
            if df.empty or x_axis not in df.columns or y_axis not in df.columns:
                return jsonify({'chart_data': [], 'insights': {'Message': 'No data available for this selection.'}})

            chart_data_df = pd.pivot_table(
                df, 
                index=x_axis, 
                values=y_axis, 
                aggfunc='sum'
            ).reset_index()
            
            chart_data_df = chart_data_df.rename(columns={x_axis: 'key', y_axis: 'value'})
            
            # Insights calculation
            total_value = chart_data_df['value'].sum()
            average_value = chart_data_df['value'].mean()
            max_item = chart_data_df.loc[chart_data_df['value'].idxmax()]
            min_item = chart_data_df.loc[chart_data_df['value'].idxmin()]
            category_count = chart_data_df['key'].nunique()

            insights = {
                "Total": f"{total_value:,.2f}",
                "Average": f"{average_value:,.2f}",
                f"Highest ({max_item['key']})": f"{max_item['value']:,.2f}",
                f"Lowest ({min_item['key']})": f"{min_item['value']:,.2f}",
                "Number of Categories": f"{category_count}"
            }
            
            # Format data for bar/line/pie charts
            chart_data = chart_data_df.to_dict(orient='records')
            response_data = {"chart_data": chart_data, "insights": insights}

        return jsonify(response_data)

    except Exception as e:
        print(f"Error in get-chart-data: {e}") 
        return jsonify({'error': str(e)}), 500


# --- Main Execution ---
if __name__ == '__main__':
    # --- START DIAGNOSTIC ---
    print("--- DIAGNOSTICS ---")
    print(f"Project Base Directory: {basedir}")
    print(f"Database URI is: {app.config['SQLALCHEMY_DATABASE_URI']}")
    print("-------------------")
    # --- END DIAGNOSTIC ---
    
    with app.app_context():
        # The instance folder path is derived from the URI
        instance_folder = os.path.join(basedir, 'instance')
        if not os.path.exists(instance_folder):
            print(f"Instance folder not found. Creating it at: {instance_folder}")
            os.makedirs(instance_folder)

        # Create uploads folder if it doesn't exist
        upload_folder = os.path.join(basedir, app.config['UPLOAD_FOLDER'])
        if not os.path.exists(upload_folder):
            print(f"Uploads folder not found. Creating it at: {upload_folder}")
            os.makedirs(upload_folder)

        # Create the database tables
        db.create_all()
        
    app.run(debug=True)