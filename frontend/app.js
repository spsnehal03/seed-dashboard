// State Management
let state = {
    cameraStarted: false,
    backendHost: 'snehal003-seed-detection-api.hf.space',
    backendPort: '8000',
    isOnline: true, // Force online for the demo
    lastDetections: []
};

function getBackendURL() {
    return "https://snehal003-seed-detection-api.hf.space";
}

// DOM Elements
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const papayaCountEl = document.getElementById("papayaCount");
const pepperCountEl = document.getElementById("pepperCount");
const startBtn = document.getElementById("startBtn");
const cameraOverlay = document.getElementById("cameraOverlay");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const hostInput = document.getElementById("hostInput");
const portInput = document.getElementById("portInput");
const saveSettings = document.getElementById("saveSettings");
const closeSettings = document.getElementById("closeSettings");

// Initialize Settings
hostInput.value = state.backendHost;
portInput.value = state.backendPort;

// --- UTILITIES ---

function updateStatus(online, message) {
    state.isOnline = online;
    statusDot.className = `dot ${online ? 'online' : 'offline'}`;
    statusText.innerText = message || (online ? "Backend Online" : "Backend Offline");
}

function getBackendURL() {
    let host = state.backendHost.trim();
    if (host.endsWith('/')) host = host.slice(0, -1);
    
    // Auto-fix for Hugging Face (Must be https)
    if (host.includes('hf.space') && !host.startsWith('https')) {
        host = 'https://' + host.replace('http://', '');
    }
    
    if (host.startsWith('http')) return host;
    return `http://${host}:${state.backendPort}`;
}

async function checkConnection() {
    const host = getBackendURL();
    try {
        const res = await fetch(host + "/", { cache: "no-cache" });
        if (res.ok) {
            updateStatus(true, "System Online & Ready");
        } else {
            updateStatus(false, "Server Error: " + res.status);
        }
    } catch (e) {
        updateStatus(false, "Connection Fail: " + e.message);
    }
}

// --- CAMERA LOGIC ---

async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" }, // Rear camera
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: false
        });

        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            state.cameraStarted = true;
            cameraOverlay.classList.add("hidden");
            updateStatus(state.isOnline, "Camera Active & Scanning");
        };

    } catch (error) {
        console.error("Camera Error:", error);
        alert("Camera Access Denied: Please use HTTPS or enable Chrome flags for insecure origins.");
    }
}

// --- DETECTION & DRAWING ---

function drawOverlay(detections) {
    state.lastDetections = detections;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let counts = { papaya: 0, pepper: 0 };

    detections.forEach(obj => {
        const [x1, y1, x2, y2] = obj.bbox;
        const name = (obj.class || "Seed").toLowerCase();
        
        // Match exactly what the model says
        const isPapaya = name.includes("papaya");
        const isPepper = name.includes("pepper");
        const color = isPapaya ? "#22c55e" : (isPepper ? "#ef4444" : "#f59e0b"); 
        
        if (isPapaya) counts.papaya++;
        else if (isPepper) counts.pepper++;

        // Draw Box
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Draw Label
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
    if (!state.cameraStarted || video.readyState < 2) return;

    // Force alignment
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // REAL DETECTION
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = video.videoWidth;
    offscreenCanvas.height = video.videoHeight;
    const offCtx = offscreenCanvas.getContext("2d");
    offCtx.drawImage(video, 0, 0);

    offscreenCanvas.toBlob(async (blob) => {
        const formData = new FormData();
        formData.append("file", blob, "frame.jpg");

        const url = `${getBackendURL()}/detect`;
        try {
            const res = await fetch(url, {
                method: "POST",
                body: formData,
                cache: "no-cache"
            });

            if (!res.ok) throw new Error("Backend Error");

            const data = await res.json();
            if (data.detections) {
                drawOverlay(data.detections);
                updateStatus(true, `Detection Active (${data.detections.length})`);
            }
        } catch (error) {
            console.error("Inference Error:", error);
            updateStatus(false, "Error: " + error.message + " | URL: " + url);
        }
    }, "image/jpeg", 0.5); // 0.5 quality for faster upload
}

// --- EVENT LISTENERS ---

startBtn.addEventListener("click", initCamera);

settingsBtn.addEventListener("click", () => {
    settingsModal.style.display = "flex";
});

closeSettings.addEventListener("click", () => {
    settingsModal.style.display = "none";
});

saveSettings.addEventListener("click", () => {
    state.backendHost = hostInput.value.trim();
    state.backendPort = portInput.value.trim();
    
    localStorage.setItem('backendHost', state.backendHost);
    localStorage.setItem('backendPort', state.backendPort);
    
    settingsModal.style.display = "none";
    checkConnection();
});

// Run detection loop
setInterval(processFrame, 500); // 2 FPS for better real-time feel

// Initial Check
checkConnection();