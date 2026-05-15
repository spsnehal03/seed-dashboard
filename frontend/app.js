// State Management
let state = {
    cameraStarted: false,
    backendHost: 'snehal003-seed-detection-api.hf.space',
    isOnline: true,
    lastDetections: []
};

function getBackendURL() {
    return "https://snehal003-seed-detection-api.hf.space";
}

// DOM Elements
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const startBtn = document.getElementById("startBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const papayaCountEl = document.getElementById("papayaCount");
const pepperCountEl = document.getElementById("pepperCount");

function updateStatus(online, message) {
    state.isOnline = online;
    statusDot.className = `dot ${online ? 'online' : 'offline'}`;
    statusText.innerText = message || (online ? "System Ready" : "System Offline");
}

async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 640 } },
            audio: false
        });
        video.srcObject = stream;
        await video.play();
        
        document.getElementById("cameraOverlay").classList.add("hidden");
        state.cameraStarted = true;
        
        // Match canvas to video exactly
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        updateStatus(true, "Scanning Seeds...");
    } catch (err) {
        alert("Camera Error: Please allow permissions.");
    }
}

function drawOverlay(detections) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let counts = { papaya: 0, pepper: 0 };

    detections.forEach(obj => {
        const [x1, y1, x2, y2] = obj.bbox;
        const name = obj.class.toLowerCase();
        const isPapaya = name.includes("papaya");
        const color = isPapaya ? "#22c55e" : "#ef4444"; 
        
        if (isPapaya) counts.papaya++;
        else counts.pepper++;

        // Draw Box
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Draw Label
        ctx.fillStyle = color;
        ctx.font = "bold 16px Outfit";
        ctx.fillText(name.toUpperCase(), x1, y1 - 5);
    });

    papayaCountEl.innerText = counts.papaya;
    pepperCountEl.innerText = counts.pepper;
}

async function processFrame() {
    if (!state.cameraStarted || video.readyState < 2) return;

    // Send whole frame
    const offCanvas = document.createElement("canvas");
    offCanvas.width = video.videoWidth;
    offCanvas.height = video.videoHeight;
    const offCtx = offCanvas.getContext("2d");
    offCtx.drawImage(video, 0, 0);

    offCanvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append("file", blob, "frame.jpg");
        try {
            const res = await fetch(`${getBackendURL()}/detect`, { method: "POST", body: formData });
            const data = await res.json();
            if (data.detections) {
                drawOverlay(data.detections);
                updateStatus(true, `Found: ${data.detections.length}`);
            }
        } catch (e) {}
    }, "image/jpeg", 0.6);
}

startBtn.addEventListener("click", initCamera);
setInterval(processFrame, 700);