// State Management
let state = {
    cameraStarted: false,
    backendHost: 'snehal003-seed-detection-api.hf.space',
    isOnline: true,
    isProcessing: false, // LOCK to prevent lag
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
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        video.srcObject = stream;
        await video.play();
        
        document.getElementById("cameraOverlay").classList.add("hidden");
        state.cameraStarted = true;
        
        // Match canvas exactly
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

        // Draw Thick Visible Box
        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Draw Label with Background
        ctx.fillStyle = color;
        const labelText = name.toUpperCase();
        ctx.font = "bold 18px Outfit";
        ctx.fillRect(x1, y1 - 25, ctx.measureText(labelText).width + 10, 25);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(labelText, x1 + 5, y1 - 7);
    });

    papayaCountEl.innerText = counts.papaya;
    pepperCountEl.innerText = counts.pepper;
}

async function processFrame() {
    if (!state.cameraStarted || video.readyState < 2 || state.isProcessing) return;

    state.isProcessing = true; // LOCK
    
    // Ensure canvas matches video size perfectly
    if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }

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
                updateStatus(true, `Detection Active (${data.detections.length})`);
            }
        } catch (e) {
            console.error(e);
        } finally {
            state.isProcessing = false; // UNLOCK
        }
    }, "image/jpeg", 0.5);
}

startBtn.addEventListener("click", initCamera);
// Run scanning as fast as the server can handle
setInterval(processFrame, 100); 