from fastapi import FastAPI, UploadFile, File, Query, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import os
import time
import glob
import base64
import uuid
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

# --- SNAPSHOT DIRECTORY ---
SNAPSHOTS_DIR = "snapshots"
os.makedirs(SNAPSHOTS_DIR, exist_ok=True)

def cleanup_old_snapshots():
    """Deletes files in SNAPSHOTS_DIR older than 24 hours."""
    now = time.time()
    for filepath in glob.glob(os.path.join(SNAPSHOTS_DIR, "*")):
        if os.path.isfile(filepath):
            file_mod_time = os.path.getmtime(filepath)
            # 24 hours = 86400 seconds
            if now - file_mod_time > 86400:
                try:
                    os.remove(filepath)
                except Exception as e:
                    print(f"Failed to delete {filepath}: {e}")

# Global variables to store loaded models
rcnn_model = None
rcnn_load_error = "Model file not found"
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

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
        rcnn_load_error = None
        print("Faster R-CNN Model loaded successfully.")
    except Exception as e:
        import traceback
        rcnn_load_error = str(e) + "\n" + traceback.format_exc()
        print(f"Error loading Faster R-CNN model: {rcnn_load_error}")

# Classes dictionary matching teammates' model
rcnn_classes = {
    1: "pepper",     # Black_pepper
    2: "papaya"      # Papaya_seed
}

@app.get("/")
def home():
    status = {
        "message": "Seed Detection API is Running on Hugging Face",
        "rcnn_loaded": rcnn_model is not None,
        "device": str(device)
    }
    return status

@app.post("/save_snapshot")
async def save_snapshot(background_tasks: BackgroundTasks, image_base64: str = Form(...)):
    try:
        # Schedule cleanup task to run in the background after returning response
        background_tasks.add_task(cleanup_old_snapshots)
        
        # Strip the data:image/jpeg;base64, prefix if present
        if "," in image_base64:
            _, encoded = image_base64.split(",", 1)
        else:
            encoded = image_base64
            
        decoded_data = base64.b64decode(encoded)
        
        # Save file with a timestamp
        timestamp = time.strftime("%Y%m%d-%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        filename = f"snapshot_{timestamp}_{unique_id}.jpg"
        filepath = os.path.join(SNAPSHOTS_DIR, filename)
        
        with open(filepath, "wb") as f:
            f.write(decoded_data)
            
        return {"status": "success", "filename": filename}
    except Exception as e:
        return {"error": str(e)}

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

        if rcnn_model is None:
            return {"error": f"Model failed to load: {rcnn_load_error}", "detections": []}

        detections = []

        # --- FASTER R-CNN INFERENCE ---
        orig_h, orig_w = frame.shape[:2]
        
        # Calculate proportional scale to speed up inference without squishing or cropping
        scale = 640.0 / max(orig_w, orig_h)
        inf_w = int(orig_w * scale)
        inf_h = int(orig_h * scale)
        
        # Resize proportionally. NO SQUISHING, NO CROPPING.
        resized_frame = cv2.resize(frame, (inf_w, inf_h))
        
        # --- EXPOSURE RECOVERY ---
        # Iriun webcam's auto-exposure often washes out the delicate ridges of Papaya seeds.
        # We apply a slight contrast boost to mathematically deepen the shadows 
        # and recover the ridges before the AI sees it.
        enhanced_frame = cv2.convertScaleAbs(resized_frame, alpha=1.3, beta=-20)
        
        rgb_frame = cv2.cvtColor(enhanced_frame, cv2.COLOR_BGR2RGB)
        # --- TEST-TIME AUGMENTATION (TTA) ---
        # The AI is blind to vertical Papaya seeds due to rotational bias in its training.
        # We bypass this by passing BOTH the normal image AND a 90-degree rotated image 
        # to the AI simultaneously.
        tensor1 = F.to_tensor(rgb_frame).to(device)
        
        rotated_frame = cv2.rotate(rgb_frame, cv2.ROTATE_90_CLOCKWISE)
        tensor2 = F.to_tensor(rotated_frame).to(device)
        
        with torch.no_grad():
            preds = rcnn_model([tensor1, tensor2])
            pred1, pred2 = preds[0], preds[1]
            
        boxes1, labels1, scores1 = pred1["boxes"], pred1["labels"], pred1["scores"]
        boxes2, labels2, scores2 = pred2["boxes"], pred2["labels"], pred2["scores"]
        
        # Rotate boxes2 back to the original orientation
        # 90-deg clockwise inverse mapping: x_orig = y_rot, y_orig = inf_h - x_rot
        if len(boxes2) > 0:
            x1_rot, y1_rot, x2_rot, y2_rot = boxes2[:, 0], boxes2[:, 1], boxes2[:, 2], boxes2[:, 3]
            x1_orig = y1_rot
            y1_orig = inf_h - x2_rot
            x2_orig = y2_rot
            y2_orig = inf_h - x1_rot
            boxes2_orig = torch.stack([x1_orig, y1_orig, x2_orig, y2_orig], dim=1)
        else:
            boxes2_orig = boxes2
            
        # Combine predictions from both orientations
        boxes = torch.cat((boxes1, boxes2_orig))
        labels = torch.cat((labels1, labels2))
        scores = torch.cat((scores1, scores2))
        
        # Filter by high confidence
        confidence_threshold = 0.60
        nms_threshold = 0.30
        
        keep = (scores > confidence_threshold)
        boxes = boxes[keep]
        labels = labels[keep]
        scores = scores[keep]
        
        if len(boxes) > 0:
            # --- ADULTERATION BIAS ---
            # If the normal image says Pepper but the rotated image says Papaya,
            # this boost guarantees the Papaya prediction wins during NMS!
            papaya_mask = (labels == 2)
            scores[papaya_mask] += 0.20
            
            keep_idx = nms(boxes, scores, nms_threshold)
            boxes = boxes[keep_idx]
            labels = labels[keep_idx]
            scores = scores[keep_idx]
            
            # Restore original scores
            scores[labels == 2] -= 0.20
            scores = torch.clamp(scores, 0.0, 1.0)
            
            # Scale boxes back from inference resolution to original frame's resolution
            scale_x = orig_w / inf_w
            scale_y = orig_h / inf_h
            boxes[:, 0] *= scale_x
            boxes[:, 2] *= scale_x
            boxes[:, 1] *= scale_y
            boxes[:, 3] *= scale_y
            
        for box, label, score in zip(boxes, labels, scores):
            x1, y1, x2, y2 = map(int, box.tolist())
            
            box_w = x2 - x1
            box_h = y2 - y1
            
            # Simple noise filter to reject tiny artifacts
            area = box_w * box_h
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

        print(f"[R-CNN] Detected {len(detections)} seeds")
        return {"detections": detections, "engine": "rcnn"}

    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        print("ERROR IN DETECT:", err_msg)
        return {"error": str(e), "traceback": err_msg, "detections": []}
