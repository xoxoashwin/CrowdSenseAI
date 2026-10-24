\# CrowdSense AI



AI-powered crowd counting and occupancy monitoring system that detects people entering and exiting a monitored area using computer vision.



\## Overview



CrowdSense AI uses YOLO-based person detection, ByteTrack object tracking, and virtual line-crossing logic to estimate entries, exits, and current occupancy from video footage.



The backend exposes a REST API built with FastAPI and stores event history using SQLite.



\## Features



\- Person detection using YOLO

\- Object tracking using ByteTrack

\- Entry and exit counting using virtual line crossing

\- Current occupancy and peak occupancy tracking

\- Video upload and processing

\- Processing progress and status monitoring

\- Persistent event history using SQLite

\- REST API with interactive Swagger documentation

\- Automated tests for core functionality



\## Tech Stack



\- Python

\- FastAPI

\- OpenCV

\- Ultralytics YOLO

\- ByteTrack

\- SQLite

\- Pytest



\## Project Structure



```text

CrowdSenseAI/

├── backend/

│   ├── main.py

│   ├── counter.py

│   ├── database.py

│   ├── schemas.py

│   └── video\_processor.py

├── tests/

├── requirements.txt

├── .gitignore

└── README.md

```



\## Prerequisites



\- Python 3.12

\- Git

\- Internet access for installing dependencies and obtaining the YOLO model weights



\## Setup



\### 1. Clone the repository



```bash

git clone <YOUR\_REPOSITORY\_URL>

cd CrowdSenseAI

```



\### 2. Create and activate a virtual environment



Windows PowerShell:



```powershell

python -m venv .venv

.\\.venv\\Scripts\\Activate.ps1

```



\### 3. Install dependencies



```powershell

python -m pip install -r requirements.txt

```



If video upload support requires it and it is not already listed in `requirements.txt`, install `python-multipart`:



```powershell

python -m pip install python-multipart

```



\### 4. Obtain the YOLO model



Place the `yolov8n.pt` model weights file in the project root, unless your configuration specifies another model path.



Do not commit model weights to Git unless the team explicitly decides to distribute them that way.



\## Run the Backend



From the project root, run:



```powershell

python -m uvicorn backend.main:app --reload

```



The API will be available at:



\- API base URL: `http://127.0.0.1:8000`

\- Interactive API documentation: `http://127.0.0.1:8000/docs`



\## API Endpoints



| Method | Endpoint | Purpose |

|---|---|---|

| GET | `/health` | Check backend health |

| GET | `/stats` | Retrieve occupancy statistics |

| POST | `/events/entry` | Record an entry event |

| POST | `/events/exit` | Record an exit event |

| GET | `/events` | Retrieve event history |

| POST | `/reset` | Reset the current counter state |

| POST | `/video/upload` | Upload a video for processing |

| POST | `/video/process` | Start video processing |

| GET | `/video/status` | Check processing status and progress |

| POST | `/video/stop` | Request processing to stop |



\## Running Tests



```powershell

python -m pytest -v

```



\## Notes



\- Video processing requires a valid video file and available YOLO model weights.

\- Entry and exit counts depend on camera angle, tracking quality, and virtual line placement.

\- The occupancy counter estimates the number of people in the monitored area; it may require calibration for a particular camera setup.

\- The backend and dashboard must be running and configured to communicate for the complete application workflow.



\## Team



Developed as a hackathon project.





