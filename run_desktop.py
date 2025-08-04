import webview
from app import app, db
import threading
import os

# --- Function to run the Flask app ---
def run_flask_app():
    # Before running, make sure the database and folders exist.
    with app.app_context():
        # Create instance folder if it doesn't exist
        instance_folder = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'instance')
        if not os.path.exists(instance_folder):
            os.makedirs(instance_folder)
            print(f"Instance folder created at: {instance_folder}")

        # Create the database tables
        db.create_all()
    
    # Run the app without debug mode for the desktop version
    app.run(debug=False)

if __name__ == '__main__':
    # Start the Flask server in a separate thread
    flask_thread = threading.Thread(target=run_flask_app)
    flask_thread.daemon = True
    flask_thread.start()

    # Create and start the PyWebView window
    # This window will load the URL of our running Flask app.
    webview.create_window(
        'Inlytix BI',  # Window Title
        'http://127.0.0.1:5000', # URL to load
        width=1280,
        height=720
    )
    webview.start()
