// State Management
let state = {
    cameraStarted: false,
    backendHost: 'snehal003-seed-detection-api.hf.space',
    backendPort: '8000',
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

// --- UTILITIES ---

function updateStatus(online, message) {
    state.isOnline = online;
    statusDot.className = `dot ${online ? 'online' : 'offline'}`;
    statusText.innerText = message || (online ? "System Ready" : "System Offline");
}

// --- CAMERA LOGIC ---

async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        video.srcObject = stream;
        
        // Force play immediately for mobile browsers
        await video.play();
        
        state.cameraStarted = true;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        startBtn.style.display = "none";
        updateStatus(true, "Camera Active & Scanning");
    } catch (err) {
        console.error("Camera Error:", err);
        alert("Please enable camera permissions.");
    }
}

// --- DETECTION LOGIC ---

function drawOverlay(detections) {
    state.lastDetections = detections;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // DRAW GUIDE BOX (ROI)
    const size = 400;
    const gx = (canvas.width - size) / 2;
    const gy = (canvas.height - size) / 2;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = 2;
    ctx.strokeRect(gx, gy, size, size);
    ctx.setLineDash([]);

    let counts = { papaya: 0, pepper: 0 };

    detections.forEach(obj => {
        const [x1, y1, x2, y2] = obj.bbox;
        const name = (obj.class || "Seed").toLowerCase();
        const isPapaya = name.includes("papaya");
        const color = isPapaya ? "#22c55e" : "#ef4444"; 
        
        if (isPapaya) counts.papaya++;
        else counts.pepper++;

        ctx.strokeStyle = color;
        ctx.lineWidth = 6;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        ctx.fillStyle = color;
        const labelText = name.toUpperCase();
        ctx.font = "bold 20px Outfit";
        ctx.fillRect(x1, y1 - 30, ctx.measureText(labelText).width + 10, 30);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(labelText, x1 + 5, y1 - 8);
    });

    papayaCountEl.innerText = counts.papaya;
    pepperCountEl.innerText = counts.pepper;
}

async function processFrame() {
    if (!state.cameraStarted || video.readyState < 2) return;

    // Center Crop (ROI)
    const size = 400;
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    
    const offCanvas = document.createElement("canvas");
    offCanvas.width = size;
    offCanvas.height = size;
    const offCtx = offCanvas.getContext("2d");
    offCtx.drawImage(video, sx, sy, size, size, 0, 0, size, size);

    offCanvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append("file", blob, "frame.jpg");
        const url = `${getBackendURL()}/detect`;

        try {
            const res = await fetch(url, { method: "POST", body: formData });
            const data = await res.json();
            if (data.detections) {
                // Adjust coordinates to global space
                const adjusted = data.detections.map(d => ({
                    ...d,
                    bbox: [
                        d.bbox[0] + sx,
                        d.bbox[1] + sy,
                        d.bbox[2] + sx,
                        d.bbox[3] + sy
                    ]
                }));
                drawOverlay(adjusted);
                updateStatus(true, `Detection Active (${data.detections.length})`);
            }
        } catch (e) {
            console.error(e);
        }
    }, "image/jpeg", 0.5);
}

// --- INIT ---
startBtn.addEventListener("click", initCamera);
setInterval(processFrame, 600); // Fast enough but stable