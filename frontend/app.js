// State Management
let state = {
    cameraStarted: false,
    backendHost: localStorage.getItem('backendHost') || '192.168.1.15',
    backendPort: localStorage.getItem('backendPort') || '8000',
    isOnline: false,
    lastDetections: []
};

// FORCE KILL DEMO MODE FOREVER
localStorage.removeItem('demoMode');
state.demoMode = false;

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
            updateStatus(false, "Backend Error: " + res.status);
        }
    } catch (e) {
        updateStatus(false, "Backend Offline - Wake up Space");
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
        const isPapaya = obj.class === "papaya";
        const color = isPapaya ? "#22c55e" : "#ef4444"; // Green for Papaya, Red for Pepper
        
        if (isPapaya) counts.papaya++;
        else counts.pepper++;

        // Draw Bounding Box (Thinner for precision)
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Draw center dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x1 + (x2-x1)/2, y1 + (y2-y1)/2, 3, 0, Math.PI * 2);
        ctx.fill();

        // Small Label
        ctx.font = "600 12px Outfit";
        ctx.fillText(`${obj.class}`, x1, y1 - 5);
    });

    papayaCountEl.innerText = counts.papaya;
    pepperCountEl.innerText = counts.pepper;
}

async function processFrame() {
    if (!state.cameraStarted || video.readyState < 2) return;

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
                const count = data.debug_count !== undefined ? data.debug_count : data.detections.length;
                updateStatus(true, `Scanning... (Found: ${count})`);
            }
        } catch (error) {
            console.error("Inference Error:", error);
            updateStatus(false, "Error: " + error.message + " | URL: " + url);
        }
    }, "image/jpeg", 0.7); // 0.7 quality to save bandwidth
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
setInterval(processFrame, 1000); // 1.0 FPS for maximum stability on free hosting

// Initial Check
checkConnection();