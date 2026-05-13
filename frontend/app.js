const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const papayaCountEl = document.getElementById("papayaCount");
const pepperCountEl = document.getElementById("pepperCount");

const startBtn = document.getElementById("startBtn");
const container = document.getElementById("container");

let cameraStarted = false;
let backendURL = "http://192.168.1.15:8080";

// OPEN CAMERA BUTTON
startBtn.addEventListener("click", async () => {

    if (cameraStarted) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" }
            },
            audio: false
        });

        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        };

        container.style.display = "block";
        cameraStarted = true;
        
    } catch (error) {
        alert("Camera access denied or not available: " + error.message);
    }

});

// DRAW BOXES
function drawBoxes(detections) {

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let papayaCount = 0;
    let pepperCount = 0;

    detections.forEach(obj => {

        const [x1, y1, x2, y2] = obj.bbox;

        let color = "yellow";

        if (obj.class === "papaya") {
            color = "green";
            papayaCount++;
        }

        if (obj.class === "pepper") {
            color = "red";
            pepperCount++;
        }

        ctx.strokeStyle = color;
        ctx.lineWidth = 3;

        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        ctx.fillStyle = color;
        ctx.font = "18px Arial";

        ctx.fillText(
            obj.class + " " + obj.confidence.toFixed(2),
            x1,
            y1 - 10
        );

    });

    papayaCountEl.innerText = papayaCount;
    pepperCountEl.innerText = pepperCount;
}

// SEND FRAMES
async function sendFrame() {

    if (!cameraStarted) return;

    if (video.videoWidth === 0) return;

    const tempCanvas = document.createElement("canvas");

    tempCanvas.width = video.videoWidth;
    tempCanvas.height = video.videoHeight;

    const tempCtx = tempCanvas.getContext("2d");

    tempCtx.drawImage(video, 0, 0);

    tempCanvas.toBlob(async (blob) => {

        const formData = new FormData();

        formData.append("file", blob, "frame.jpg");

        try {
            const res = await fetch(backendURL + "/detect", {
                method: "POST",
                body: formData
            });

            if (!res.ok) {
                console.error("Backend error:", res.status);
                return;
            }

            const data = await res.json();

            if (data.detections) {
                drawBoxes(data.detections);
            }

        } catch (error) {
            console.error("Error connecting to backend:", error);
        }

    }, "image/jpeg");

}

setInterval(sendFrame, 500);