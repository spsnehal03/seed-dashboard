from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import cv2
import numpy as np
import os

app = FastAPI()

# Enable CORS for Vercel
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model (make sure best.onnx is in the same folder)
model_path = "best.onnx"
if os.path.exists(model_path):
    model = YOLO(model_path, task="detect")
else:
    print(f"Error: {model_path} not found!")

@app.get("/")
def home():
    return {"message": "Seed Detection API is Running on Hugging Face"}

@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    contents = await file.read()
    np_arr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    
    if frame is None:
        return {"error": "Could not decode image", "detections": []}
    
    # Run YOLO prediction with lower threshold for better sensitivity
    results = model.predict(frame, conf=0.1)
    
    detections = []
    for box in results[0].boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        cls_id = int(box.cls[0])
        confidence = float(box.conf[0])
        class_name = "papaya" if cls_id == 0 else "pepper"
        
        detections.append({
            "bbox": [x1, y1, x2, y2],
            "class": class_name,
            "confidence": confidence
        })
    
    print(f"Detected {len(detections)} seeds") # This will show in HF Logs
    return {"detections": detections}
