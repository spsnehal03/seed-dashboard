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

# Load model
model = YOLO("../model_files/best.onnx", task="detect")

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
    
    if frame is None:
        return {"error": "Could not decode image", "detections": []}
    
    # Run model prediction
    results = model.predict(frame, conf=0.25)
    
    detections = []
    
    # Extract detections
    for box in results[0].boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        cls_id = int(box.cls[0])
        confidence = float(box.conf[0])
        
        # Get class name (0=papaya, 1=pepper)
        class_name = "papaya" if cls_id == 0 else "pepper"
        
        detections.append({
            "bbox": [x1, y1, x2, y2],
            "class": class_name,
            "confidence": confidence
        })
    
    return {"detections": detections}
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)