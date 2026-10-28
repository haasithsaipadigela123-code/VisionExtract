# Vision Extract — Local Execution Guide

This document contains all the standard **Command Prompt (`cmd`)** commands to set up, run, and manage Vision Extract on your local machine.

---

## 🚀 Quick Start (One-Liner)

If your environment is already set up, open Command Prompt (`cmd`) and run:

```cmd
cd "C:\Users\haasi\OneDrive\Documents\Mini Project" && .venv\Scripts\activate && python app.py
```

Then open your browser and navigate to:
**[http://127.0.0.1:5000](http://127.0.0.1:5000)**

---

## 📋 Step-by-Step Instructions

### Step 1: Open Command Prompt & Navigate to Project Directory
```cmd
cd "C:\Users\haasi\OneDrive\Documents\Mini Project"
```

### Step 2: Create Python Virtual Environment (First time only)
```cmd
python -m venv .venv
```

### Step 3: Activate the Virtual Environment
```cmd
.venv\Scripts\activate
```
*(When active, you will see `(.venv)` at the beginning of your command line prompt.)*

### Step 4: Install Dependencies
```cmd
pip install -r requirements.txt
```

### Step 5: Start the Flask Application
```cmd
python app.py
```

You should see output similar to:
```text
 * Serving Flask app 'app'
 * Debug mode: off
 * Running on http://127.0.0.1:5000
Press CTRL+C to quit
```

### Step 6: Open in Browser
Open Google Chrome, Edge, or your preferred browser:
- **URL**: `http://127.0.0.1:5000`

---

## 🛑 How to Stop & Exit

- **Stop the Flask Server**: Press `Ctrl + C` in the Command Prompt window.
- **Deactivate the Virtual Environment**:
  ```cmd
  deactivate
  ```

---

## 🔄 How to Push Changes to GitHub

Whenever you make changes to the code:

```cmd
cd "C:\Users\haasi\OneDrive\Documents\Mini Project"
git add .
git commit -m "Update code"
git push origin main
```

---

## 🛠️ Troubleshooting

| Issue | Solution |
| :--- | :--- |
| **`python` not recognized** | Use `py` instead of `python` (e.g. `py app.py`) or ensure Python is added to your Windows system PATH. |
| **Port 5000 already in use** | Find and terminate the process holding port 5000:<br>`netstat -ano \| findstr :5000`<br>`taskkill /PID <PID_NUMBER> /F` |
| **Missing packages** | Run `.venv\Scripts\activate` followed by `pip install -r requirements.txt`. |
| **Browser OCR slow** | In the UI, use lower frame extraction rates (e.g., 0.5 FPS or 1 FPS) for long video files. |
