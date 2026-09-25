// Mock robot camera feed. Draws a synthetic robot's-eye view with fake
// detection overlays. No real camera, video, or network access. The real
// feed is owned by the Edge Computer integration (pending).

export function createCameraFeed(canvas, { label = "H1 FORWARD CAM" } = {}) {
  if (!canvas) return { start() {}, stop() {} };
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  let raf = null, frame = 0, liveImage = null;

  // Synthetic detected objects that drift slightly to look live.
  const boxes = [
    { x: 0.16, y: 0.34, w: 0.24, h: 0.30, tag: "TOTE 447", conf: 0.97 },
    { x: 0.58, y: 0.24, w: 0.20, h: 0.22, tag: "SHELF EDGE", conf: 0.88 }
  ];

  function draw() {
    frame += 1;
    const t = frame / 60;

    // If a real Isaac Sim frame is available, show it instead of the mock scene.
    if (liveImage && liveImage.complete && liveImage.naturalWidth > 0) {
      ctx.drawImage(liveImage, 0, 0, W, H);
      ctx.fillStyle = "#37d67a"; ctx.font = "bold 11px Consolas, monospace";
      ctx.fillText("● LIVE ISAAC FRAME", 8, 16);
      ctx.fillStyle = "#7fd0ff"; ctx.font = "11px Consolas, monospace";
      ctx.fillText(new Date().toLocaleTimeString(), 8, H - 10);
      raf = requestAnimationFrame(draw);
      return;
    }

    // Camera background
    ctx.fillStyle = "#0d1420";
    ctx.fillRect(0, 0, W, H);

    // Perspective floor grid
    ctx.strokeStyle = "rgba(90,150,190,0.18)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i += 1) {
      const y = H * (0.55 + i * 0.055);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let i = -4; i <= 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * 18, H * 0.55);
      ctx.lineTo(W / 2 + i * 90, H);
      ctx.stroke();
    }

    // Detection boxes (drift a little each frame)
    ctx.font = "11px Consolas, monospace";
    for (const b of boxes) {
      const dx = Math.sin(t + b.x * 6) * 3, dy = Math.cos(t + b.y * 6) * 2;
      const x = b.x * W + dx, y = b.y * H + dy, w = b.w * W, h = b.h * H;
      ctx.strokeStyle = "#37d67a"; ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "rgba(55,214,122,0.9)";
      ctx.fillRect(x, y - 15, ctx.measureText(`${b.tag} ${(b.conf * 100) | 0}%`).width + 10, 15);
      ctx.fillStyle = "#062012";
      ctx.fillText(`${b.tag} ${(b.conf * 100) | 0}%`, x + 5, y - 4);
    }

    // Center crosshair
    ctx.strokeStyle = "rgba(230,80,80,0.8)"; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 12, H / 2); ctx.lineTo(W / 2 + 12, H / 2);
    ctx.moveTo(W / 2, H / 2 - 12); ctx.lineTo(W / 2, H / 2 + 12);
    ctx.stroke();

    // HUD text
    ctx.fillStyle = "#7fd0ff"; ctx.font = "11px Consolas, monospace";
    ctx.fillText(label, 8, 16);
    ctx.fillText(new Date().toLocaleTimeString(), 8, H - 10);
    ctx.fillStyle = (frame % 40 < 20) ? "#ff5b5b" : "#803030";
    ctx.fillText("● REC", W - 52, 16);

    // SIMULATED watermark
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(-0.35);
    ctx.font = "bold 34px Segoe UI, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.textAlign = "center";
    ctx.fillText("SIMULATED", 0, 0);
    ctx.restore();

    raf = requestAnimationFrame(draw);
  }

  return {
    start() { if (!raf) draw(); },
    stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } },
    // Pass a loaded <img> to show a real Isaac frame; pass null to return to the mock scene.
    setLiveImage(img) { liveImage = img && img.complete && img.naturalWidth > 0 ? img : null; }
  };
}
