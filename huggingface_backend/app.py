from fastapi import FastAPI, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import os
import torch
import torchvision
from torchvision.transforms import functional as F
from torchvision.ops import nms
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor
from ultralytics import YOLO

app = FastAPI()

# Enable CORS for Vercel
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables to store loaded models
yolo_model = None
rcnn_model = None
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# --- LOAD YOLO MODEL ---
YOLO_PATH = "best.onnx"
if os.path.exists(YOLO_PATH):
    try:
        yolo_model = YOLO(YOLO_PATH, task="detect")
        print("YOLOv8 Model loaded successfully.")
    except Exception as e:
        print(f"Error loading YOLO model: {e}")

# --- LOAD FASTER R-CNN MODEL ---
RCNN_PATH = "pepper_detector_checkpoint.pth"
if os.path.exists(RCNN_PATH):
    try:
        # Recreate model architecture matching teammates' training settings
        num_classes = 3  # background + pepper + papaya
        rcnn_model = torchvision.models.detection.fasterrcnn_resnet50_fpn(weights=None, weights_backbone=None)
        in_features = rcnn_model.roi_heads.box_predictor.cls_score.in_features
        rcnn_model.roi_heads.box_predictor = FastRCNNPredictor(in_features, num_classes)
        
        # Load weight state dict
        loaded = torch.load(RCNN_PATH, map_location=device)
        if isinstance(loaded, dict) and "model_state_dict" in loaded:
            rcnn_model.load_state_dict(loaded["model_state_dict"])
        else:
            rcnn_model.load_state_dict(loaded)
            
        rcnn_model.to(device)
        rcnn_model.eval()
        print("Faster R-CNN Model loaded successfully.")
    except Exception as e:
        print(f"Error loading Faster R-CNN model: {e}")

# Classes dictionary matching teammates' model
rcnn_classes = {
    1: "pepper",     # Black_pepper
    2: "papaya"      # Papaya_seed
}

@app.get("/")
def home():
    status = {
        "message": "Seed Detection API is Running on Hugging Face",
        "yolo_loaded": yolo_model is not None,
        "rcnn_loaded": rcnn_model is not None,
        "device": str(device)
    }
    return status

@app.post("/detect")
async def detect(
    file: UploadFile = File(...),
    model_type: str = Query("auto", description="Model to use: 'rcnn', 'yolo', or 'auto'")
):
    contents = await file.read()
    np_arr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    
    try:
        if frame is None:
            return {"error": "Could not decode image", "detections": []}

        # Decide which model to use
        use_rcnn = False
        if model_type == "rcnn" and rcnn_model is not None:
            use_rcnn = True
        elif model_type == "yolo" and yolo_model is not None:
            use_rcnn = False
        else:
            # 'auto' mode: Prefer R-CNN if loaded, fallback to YOLO
            use_rcnn = rcnn_model is not None

        detections = []

        if use_rcnn:
            # --- FASTER R-CNN INFERENCE ---
            orig_h, orig_w = frame.shape[:2]
            inf_w, inf_h = 640, 480
            
            # Resize to speed up CPU inference dramatically
            resized_frame = cv2.resize(frame, (inf_w, inf_h))
            
            rgb_frame = cv2.cvtColor(resized_frame, cv2.COLOR_BGR2RGB)
            tensor = F.to_tensor(rgb_frame).to(device)
            
            with torch.no_grad():
                prediction = rcnn_model([tensor])[0]
                
            boxes = prediction["boxes"]
            labels = prediction["labels"]
            scores = prediction["scores"]
            
            # Filter by high confidence to prevent false detections
            confidence_threshold = 0.85
            nms_threshold = 0.30
            
            keep = (scores > confidence_threshold)
            boxes = boxes[keep]
            labels = labels[keep]
            scores = scores[keep]
            
            if len(boxes) > 0:
                keep_idx = nms(boxes, scores, nms_threshold)
                boxes = boxes[keep_idx]
                labels = labels[keep_idx]
                scores = scores[keep_idx]
                
                # Scale boxes back to original resolution
                scale_x = orig_w / inf_w
                scale_y = orig_h / inf_h
                boxes[:, 0] *= scale_x
                boxes[:, 2] *= scale_x
                boxes[:, 1] *= scale_y
                boxes[:, 3] *= scale_y
                
            for box, label, score in zip(boxes, labels, scores):
                x1, y1, x2, y2 = map(int, box.tolist())
                
                # --- WATERMARK FILTER ---
                # Iriun webcam puts a watermark in the bottom-left corner.
                # If a detection is in the bottom-left 20% width and bottom 20% height, ignore it.
                if x1 < (orig_w * 0.20) and y2 > (orig_h * 0.80):
                    continue
                
                # Simple noise filter to reject tiny artifacts
                area = (x2 - x1) * (y2 - y1)
                if area < 800:  
                    continue
                    
                class_id = int(label)
                class_name = rcnn_classes.get(class_id, "unknown")
                
                # Skip background or unknown detections
                if class_name == "unknown":
                    continue
                    
                detections.append({
                    "bbox": [float(x1), float(y1), float(x2), float(y2)],
                    "class": class_name,
                    "confidence": float(score)
                })
        else:
            # --- YOLOv8 INFERENCE ---
            if yolo_model is not None:
                # Set a moderate confidence to filter out random faces/objects
                results = yolo_model.predict(frame, conf=0.45, iou=0.25)
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

        print(f"[{'R-CNN' if use_rcnn else 'YOLO'}] Detected {len(detections)} seeds")
        return {"detections": detections, "engine": "rcnn" if use_rcnn else "yolo"}

    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        print("ERROR IN DETECT:", err_msg)
        return {"error": str(e), "traceback": err_msg, "detections": []}
