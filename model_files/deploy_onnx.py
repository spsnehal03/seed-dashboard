from ultralytics import YOLO
import cv2

# Load ONNX model
model = YOLO(r"C:\Users\Shreedevi F A\Desktop\yolo_project2\best.onnx")

# Open mobile camera
cap = cv2.VideoCapture(1)

# If 0 not working try 1 or 2

while True:
    ret, frame = cap.read()

    if not ret:
        print("Camera not detected")
        break

    # ROI crop (recommended)
    roi = frame[100:400, 150:500]

    # Run prediction
    results = model.predict(
        roi,
        conf=0.25
    )

    # Draw detections
    annotated = results[0].plot()
    cv2.imshow("Detection", annotated)

    # ESC key to exit
    if cv2.waitKey(1) == 27:
        break

cap.release()
cv2.destroyAllWindows()