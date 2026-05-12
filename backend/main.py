from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import cv2
import numpy as np

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load ONNX model
model = YOLO("../model_files/best.onnx")


@app.get("/")
def home():
    return {"message": "Seed Detection Backend Running"}


@app.post("/detect")
async def detect(file: UploadFile = File(...)):

    # Read image bytes
    contents = await file.read()

    # Convert to numpy array
    np_arr = np.frombuffer(contents, np.uint8)

    # Decode image
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    # Run model prediction
    results = model.predict(frame, conf=0.25)

    detections = []

    # Extract detections
    for box in results[0].boxes:

        x1, y1, x2, y2 = box.xyxy[0].tolist()

        cls_id = int(box.cls[0])
        confidence = float(box.conf[0])

        class_name = model.names[cls_id]

        detections.append({
            "class": class_name,
            "bbox": [x1, y1, x2, y2],
            "confidence": confidence
        })

    return {
        "detections": detections
    }