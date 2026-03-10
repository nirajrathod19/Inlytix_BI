# DataViz Flask App

## Overview
A Flask-based data analytics and visualization web application. Users can upload CSV/Excel files, prepare/clean data, build charts, run forecasts, generate PDF reports, and connect to external PostgreSQL databases.

## Architecture
- **Backend**: Python/Flask (app.py) - single-file app with all routes
- **Database**: SQLite (instance/users.db) via Flask-SQLAlchemy
- **Frontend**: Jinja2 templates (templates/), static CSS/JS (static/)
- **Auth**: Flask-Login with WTForms

## Key Features
- User registration/login
- CSV/Excel file upload and data preparation
- Multi-file data modeling/merging
- Chart builder with Chart.js
- Linear regression forecasting
- PDF report export (fpdf2)
- PostgreSQL database connector
- Project save/load system

## Running
- Start: `python app.py`
- Port: 5000 (host: 0.0.0.0)

## Dependencies
All Python dependencies in `requirements.txt`. scikit-learn is also required (pre-installed).
