# Etlytix BI

## Overview
A Flask-based business intelligence and data analytics web application. Users can upload data files in multiple formats, clean and prepare data, build interactive charts, explore data with natural language, and create Power BI-style interactive dashboards.

## Architecture
- **Backend**: Python/Flask (`app.py`) — single-file app with all routes
- **Database**: SQLite (`instance/users.db`) via Flask-SQLAlchemy, with optional Supabase PostgreSQL via `SUPABASE_DATABASE_URL` secret
- **Frontend**: Jinja2 templates (`templates/`), static CSS/JS (`static/`)
- **Auth**: Flask-Login + WTForms (registration, login with show/hide password, inline validation errors)

## Key Features
- **Auth**: Secure registration/login with inline field-level error display, show/hide password toggle
- **Multi-format Upload**: CSV, Excel (.xls/.xlsx), JSON, TSV, TXT, Parquet (via pyarrow)
- **Drag-and-Drop Upload**: Dropzone UI with file pills and multi-file support
- **Data Preparation**: Smart Clean (dedup, impute, date normalise), preview table, outlier highlight
- **Multi-file Modeling**: Auto-detect join keys between tables, one-click join suggestions
- **Chart Builder** (11 types): Bar, Horizontal Bar, Histogram, Line, Area, Pie, Doughnut, Polar Area, Radar, Scatter, Bubble; plus Table and Treemap
- **Aggregation Control**: Sum / Average / Count / Max / Min per chart
- **Cross-filter Drill-down**: Click any chart segment to filter the drill-down chart
- **Executive Narratives**: AI-written 2-sentence summary after each chart
- **Ask My Data**: Natural language KPI cards
- **Forecasting**: Linear regression forecast overlay on Line Charts
- **Interactive Dashboard Builder** (`/dashboard-builder`): Power BI-style
  - Gridstack.js drag-and-drop / resize grid (12-column, fluid cells)
  - Add Chart modal: all 11 chart types, aggregation, top-N, 6 color schemes
  - Cross-filtering across all tiles by clicking a segment
  - Edit, Duplicate, Remove per tile
  - Save/Load dashboard state to browser localStorage
  - Export dashboard to PDF
- **Global Search**: Navbar search across projects and dataset columns
- **Project Save/Load**: Named projects with sidebar panel
- **PDF Export**: Chart + data export via jsPDF + html2canvas

## Running
- Start: `python app.py`
- Port: 5000 (host: `0.0.0.0`)

## Dependencies
Key Python packages: `flask`, `flask-login`, `flask-sqlalchemy`, `flask-wtf`, `pandas`, `numpy`, `scikit-learn`, `fpdf2`, `gunicorn`, `pyarrow`, `openpyxl`, `xlrd`

Frontend CDN: Bootstrap 5.3, Chart.js, Gridstack 8.4, Font Awesome 6.4, jsPDF, html2canvas, Choices.js

## Supabase
Set `SUPABASE_DATABASE_URL` secret to `postgresql://postgres:[pass]@db.[ref].supabase.co:5432/postgres` to use Supabase instead of SQLite. Falls back to SQLite if the URL is invalid.
