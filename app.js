// ------------------ VARIÁVEIS GLOBAIS ------------------

// Tempo (cronômetro)
let sec = 0;
let timerInterval = null;

// Transmissão / captura
let lastDisplayStream = null; // último MediaStream de display selecionado
let streaming = false; // flag de transmissão
let backendSessionId = null; // session id returned by backend when streaming
let mediaRecorder = null; // para medir bitrate
let bitrateBytes = 0; // bytes acumulados no intervalo
let bitrateInterval = null; // intervalo que atualiza kbps

// Elementos de UI
const timerEl = document.getElementById('timer');
const statsEl = document.getElementById('stats'); // mostra FPS e Bitrate
const platformInfoEl = document.getElementById('platformInfo');
const connectedChip = document.getElementById('connectedChip');
const previewVideo = document.getElementById('previewVideo');
const previewText = document.getElementById('previewText');
const previewToggle = document.getElementById('previewToggle');

// Ícones SVG (olho / olho riscado)
const ICON_EYE = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 5C7 5 2.73 8.11 1 12c1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg>';
const ICON_EYE_SLASH = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 6a9.77 9.77 0 0 1 4.96 1.29L19 6.25C15.41 4.4 13 4 12 4 7 4 2.73 7.11 1 11c.7 1.56 1.72 2.95 2.94 4.14L3.21 17 4.64 18.42 20.78 2.29 19.36.87 15.96 4.27A9.77 9.77 0 0 1 12 6zM3.51 5.64L2.1 7.06C3.83 9.95 8.1 13 13 13c.7 0 1.38-.06 2.03-.17L15.9 11.7A5 5 0 0 1 8.3 4.1L6.9 2.7 3.51 5.64zM12 18c-5 0-9.27-3.11-11-7 .77-1.73 2.08-3.26 3.64-4.48L5.1 6.29A9.77 9.77 0 0 1 12 18z"/></svg>';

// Handler para ocultar/mostrar preview embutido (agora com ícone sobreposto)
if (previewToggle) {
    // ícone + texto inicial (mantemos texto para maior clareza)
    previewToggle.innerHTML = '<span class="btn-label">Mostrar visualização</span>';
    previewToggle.style.display = 'none';
    // status element (pode ser null se index.html não contiver)
    const previewStatusEl = document.getElementById('previewStatus');
    if (previewStatusEl) previewStatusEl.innerText = 'Preview: oculto';

    previewToggle.addEventListener('click', () => {
        if (!previewVideo) return;
        const isHidden = previewVideo.style.display === 'none' || previewVideo.style.display === '';
        if (isHidden) {
            // Mostrar preview: se houver stream, conecte; senão mostra mensagem
            if (lastDisplayStream) {
                try { previewVideo.srcObject = lastDisplayStream; } catch (e) { console.warn(e); }
                previewVideo.style.display = 'block';
                previewText.style.display = 'none';
                previewToggle.innerHTML = '<span class="btn-label">Ocultar visualização</span>';
                previewToggle.setAttribute('aria-pressed', 'true');
                if (previewStatusEl) previewStatusEl.innerText = 'Preview: visível';
                console.log('[BROCKER.TV] Preview shown');
            } else {
                previewText.innerText = 'Nenhuma transmissão em andamento.';
                previewText.style.display = 'block';
                previewVideo.style.display = 'none';
                if (previewStatusEl) previewStatusEl.innerText = 'Preview: indisponível';
                console.log('[BROCKER.TV] Preview requested but no stream available');
            }
        } else {
            // Ocultar preview
            try { previewVideo.srcObject = null; } catch(e){}
            previewVideo.style.display = 'none';
            previewText.style.display = 'block';
            previewToggle.innerHTML = '<span class="btn-label">Mostrar visualização</span>';
            previewToggle.setAttribute('aria-pressed', 'false');
            if (previewStatusEl) previewStatusEl.innerText = 'Preview: oculto';
            console.log('[BROCKER.TV] Preview hidden');
        }
    });
}

// ------------------ FUNÇÕES AUXILIARES (em Português) ------------------

function formatTime(s) {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${ss}`;
}

// Inicia o cronômetro (quando a transmissão começar)
function startTimer() {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
        sec++;
        if (timerEl) timerEl.innerText = formatTime(sec);
    }, 1000);
}

// Para o cronômetro e zera
function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    sec = 0;
    if (timerEl) timerEl.innerText = '00:00:00';
}

// Atualiza a linha de stats (FPS / Bitrate)
function updateStats(fps, kbps) {
    if (!statsEl) return;
    const fpsText = fps ? Math.round(fps) : '—';
    const kbpsText = kbps ? Math.round(kbps) : '—';
    statsEl.innerText = `FPS: ${fpsText} | Bitrate: ${kbpsText} kbps`;
}

// Toca um curto alerta (tom) para indicar o início da transmissão
function playStartTone() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 880; // frequência (Hz)
        g.gain.value = 0.0001; // start very low for safety
        o.connect(g);
        g.connect(ctx.destination);
        // ramp up and down quickly to avoid clicks
        const now = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
        o.start(now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        o.stop(now + 0.24);
        // close context after tone ends
        setTimeout(() => { try { ctx.close(); } catch (e) {} }, 300);
    } catch (e) {
        console.warn('Falha ao tocar tom de início:', e);
    }
}

// ------------------ TRANSMISSÃO: iniciar / parar / medir ------------------

// Inicia medição de bitrate utilizando MediaRecorder (se disponível)
function startBitrateMeasurement(stream) {
    // Reinicia contadores
    bitrateBytes = 0;
    // Tenta criar um MediaRecorder para contabilizar bytes
    try {
        mediaRecorder = new MediaRecorder(stream);
    } catch (err) {
        console.warn('MediaRecorder não disponível para este stream:', err);
        mediaRecorder = null;
    }

    if (mediaRecorder) {
        mediaRecorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size) bitrateBytes += ev.data.size;
        };
        mediaRecorder.start(1000); // pede chunks a cada segundo
    }

    // Intervalo que calcula kbps a cada segundo com base nos bytes recebidos
    bitrateInterval = setInterval(() => {
        const kbps = (bitrateBytes * 8) / 1000; // kilobits por segundo aproximado
        updateStats(currentFps || '—', kbps);
        // reset contador para próxima medição
        bitrateBytes = 0;
    }, 1000);
}

function stopBitrateMeasurement() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
    }
    mediaRecorder = null;
    clearInterval(bitrateInterval);
    bitrateInterval = null;
}

let currentFps = null;

// Inicia a transmissão (quando tivermos um MediaStream de display)
async function startTransmission(stream) {
    if (streaming) return; // já transmitindo
    streaming = true;
    lastDisplayStream = stream;

    // Inicia cronômetro
    startTimer();
        // play a short start alert before starting
        try { playStartTone(); } catch(e){ /* ignore */ }

    // Tenta obter fps do track (alguns navegadores/provedores fornecem frameRate)
    try {
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            const settings = videoTrack.getSettings();
            if (settings && settings.frameRate) {
                currentFps = settings.frameRate;
            }
        }
    } catch (err) {
        console.warn('Não foi possível ler frameRate do track:', err);
    }

    // Inicia medição de bitrate (apenas para dar um valor aproximado)
    startBitrateMeasurement(stream);

    // Atualiza UI
    if (btnStart) btnStart.classList.add('active');
    // Mostrar botão Encerrar quando a transmissão começa (Pause está desativado)
    if (btnStop) { btnStop.style.display = 'inline-block'; }
    // Mostrar preview embutido
    if (previewVideo) { try { previewVideo.srcObject = stream; previewVideo.style.display = 'block'; } catch(e){} }
    if (previewText) previewText.style.display = 'none';
    // Notify backend to start session (if available)
    try {
        const uid = getCurrentUserId();
        const resp = await fetch('/api/stream/start', {
            method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ localUser: uid, platform: (platformConnectedName || 'twitch') })
        });
        if (resp && resp.ok) {
            const j = await resp.json();
            if (j && j.sessionId) {
                backendSessionId = j.sessionId;
                console.log('[BROCKER.TV] backend session started', backendSessionId);
            }
        }
    } catch (e) { console.warn('[BROCKER.TV] backend start session failed', e); }
}

// Para a transmissão e libera recursos
function stopTransmission() {
    if (!streaming) return;
    streaming = false;

    // Para timer
    stopTimer();

    // Para medição
    stopBitrateMeasurement();

    // Para tracks do stream (se quisermos liberar captura)
    if (lastDisplayStream) {
        lastDisplayStream.getTracks().forEach(t => {
            try { t.stop(); } catch (e) { }
        });
        lastDisplayStream = null;
    }

    // Reset UI
    updateStats('—', '—');
    if (btnStart) btnStart.classList.remove('active');
    // Esconder botão Encerrar quando a transmissão termina
    if (btnStop) { btnStop.style.display = 'none'; }
    // Desabilita e oculta o botão de preview quando não há transmissão
    if (previewToggle) { previewToggle.disabled = true; previewToggle.style.display = 'none'; }
    // atualizar status de preview na UI, se existir
    const previewStatusEl = document.getElementById('previewStatus');
    if (previewStatusEl) previewStatusEl.innerText = 'Preview: oculto';
    // Reset preview embutido
    if (previewVideo) { try { previewVideo.srcObject = null; previewVideo.style.display = 'none'; } catch(e){} }
    if (previewText) { previewText.style.display = 'block'; previewText.innerText = 'Nenhuma transmissão em andamento.'; }
    // Notify backend to stop session (if available)
    try {
        const uid = getCurrentUserId();
        if (backendSessionId) {
            fetch('/api/stream/stop', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ localUser: uid, sessionId: backendSessionId }) })
                .then(r => r.json()).then(j => {
                    if (j && j.summary) {
                        console.log('[BROCKER.TV] stream summary', j.summary);
                        // show summary in xpModal
                        const body = document.querySelector('#xpModal .modal-body');
                        if (body) body.innerHTML = `<pre style="white-space:pre-wrap">${JSON.stringify(j.summary,null,2)}</pre>`;
                        openModal('xpModal');
                    }
                }).catch(e => console.warn('[BROCKER.TV] backend stop failed', e));
            backendSessionId = null;
        }
    } catch (e) { console.warn('[BROCKER.TV] notify backend stop failed', e); }
}

// ------------------ HANDLERS DE BOTÕES E UI (em Português) ------------------

// Botão selecionar tela/janela: abre o seletor e prepara o stream (NÃO inicia transmissão automaticamente)
const selectBtn = document.getElementById('selectScreen');
if (selectBtn) {
    selectBtn.addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            // Armazena o stream escolhido, mas não inicia a transmissão automaticamente
            lastDisplayStream = stream;
            // Atualiza preview embutido na página (sem iniciar o cronômetro)
            if (previewVideo) {
                try { previewVideo.srcObject = stream; previewVideo.style.display = 'block'; } catch (e) { console.warn(e); }
            }
            if (previewText) previewText.style.display = 'none';
            // Habilita e mostra o botão de ocultar/mostrar preview agora que existe um stream
            if (previewToggle) {
                previewToggle.disabled = false; previewToggle.style.display = 'inline-flex';
                // atualiza rótulo para 'Ocultar' porque a pré-visualização já aparece
                previewToggle.innerHTML = '<span class="btn-label">Ocultar visualização</span>';
            }
            const previewStatusEl = document.getElementById('previewStatus');
            if (previewStatusEl) previewStatusEl.innerText = 'Preview: visível';
            console.log('[BROCKER.TV] Screen selected for preview');
            // Observação (em Português): a transmissão só começa quando o usuário clicar em 'Transmitir'
            // --- XP: ganhar pontos ao selecionar uma janela (teste) ---
            try { awardXp(150); } catch (e) { console.warn('awardXp failed', e); }
            // Setup capture audio chain so mixer can control its volume/meter
            try { setupCaptureAudio(stream); } catch(e) { console.warn('setupCaptureAudio failed', e); }
        } catch (err) {
            console.error('Erro ao capturar tela:', err);
        }
    });
}

// ------------------ SISTEMA DE XP E CONFETES ------------------
const xpLabel = document.getElementById('xpLabel');
const xpBar = document.getElementById('xpBar');
const xpFill = document.getElementById('xpFill');
const confettiLayer = document.getElementById('confettiLayer');

let xp = 200; // valor inicial (padrão para teste)
let xpMax = 1000; // XP para upar de nível
let level = 1;

function updateXpUI() {
    if (xp < 0) xp = 0;
    const pct = Math.min(100, Math.round((xp / xpMax) * 100));
    if (xpLabel) xpLabel.innerText = `XP ${xp} / ${xpMax} (Lvl ${level})`;
    if (xpFill) xpFill.style.width = pct + '%';
    // Atualiza barra de XP no card do perfil (sevisível)
    try {
        const profFillLarge = document.querySelector('.profile-card .xp-fill-large');
        const profSub = document.querySelector('.profile-card .xp-sub');
        if (profFillLarge) profFillLarge.style.width = pct + '%';
        if (profSub) profSub.innerText = `${Math.max(0, xpMax - xp)} XP PARA O NÍVEL ${level + 1}`;
    } catch (e) { /* quiet */ }
}

function awardXp(points) {
    xp += points;
    // simple level-up loop in case points > xpMax
    let leveled = false;
    while (xp >= xpMax) {
        xp -= xpMax;
        level += 1;
        // increase required xp for next level (simple scaling)
        xpMax = Math.floor(xpMax * 1.25 + 100);
        leveled = true;
    }
    updateXpUI();
    // persist user XP for currently shown/logged user
    try { const uid = (typeof getCurrentUserId === 'function') ? getCurrentUserId() : null; if (uid) saveUserState(uid, { xp, xpMax, level }); } catch(e){}
    if (leveled) {
        // add leveled visual and launch confetti
        if (xpBar) xpBar.classList.add('leveled');
        launchConfetti();
        try { playLevelUpSound(); } catch(e){ console.warn('playLevelUpSound failed', e); }
        // keep leveled effect for a short while
        setTimeout(() => { if (xpBar) xpBar.classList.remove('leveled'); updateXpUI(); }, 6000);
    }
}

function launchConfetti() {
    if (!confettiLayer) return;
    const colors = ['#6e46b8','#1b6fff','#ff4b4b','#00e676','#ffb34d','#ffd700'];
    const count = 40;
    const created = [];
    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'confetti';
        const w = 8 + Math.round(Math.random() * 10);
        const h = 10 + Math.round(Math.random() * 10);
        el.style.width = w + 'px';
        el.style.height = h + 'px';
        el.style.background = colors[Math.floor(Math.random() * colors.length)];
        el.style.left = (10 + Math.random() * 80) + '%';
        el.style.top = (-5 - Math.random() * 5) + 'vh';
        // random rotation start
        el.style.transform = `rotate(${Math.random() * 360}deg)`;
        // random horizontal offset (used by keyframes) to create drift
        const offset = Math.round((Math.random() - 0.5) * 120); // -60 .. +60 px
        el.style.setProperty('--confetti-x', offset + 'px');
        // slower random duration and delay for a gentler fall
        const dur = 2200 + Math.round(Math.random() * 2200); // 2200..4400ms
        const delay = Math.round(Math.random() * 350);
        el.style.animation = `confetti-fall ${dur}ms cubic-bezier(.18,.9,.22,1) ${delay}ms forwards`;
        confettiLayer.appendChild(el);
        created.push(el);
    }
    // cleanup (allow time for slower animations)
    setTimeout(() => { created.forEach(e => e.remove()); }, 6500);
}

// Play a pleasant success melody using WebAudio (played on level-up)
function playLevelUpSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;
        // Two oscillators to form a pleasant interval
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        const g = ctx.createGain();
        o1.type = 'sine'; o2.type = 'sine';
        o1.frequency.value = 880; // A5
        o2.frequency.value = 1100; // ~C#6
        o2.detune.value = 6;
        g.gain.value = 0.0001;
        o1.connect(g); o2.connect(g); g.connect(ctx.destination);
        // quick envelope
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        o1.start(now); o2.start(now);
        o1.stop(now + 0.92); o2.stop(now + 0.92);
        setTimeout(() => { try { ctx.close(); } catch (e) {} }, 1100);
    } catch (e) {
        console.warn('Falha ao tocar som de level up:', e);
    }
}

// mixdown removed — we don't create a MediaStreamAudioDestinationNode here.

// Inicializa UI do XP no carregamento
updateXpUI();

// Elementos relacionados ao início da transmissão e credenciais
    // ------------------ MICROFONE: solicitar permissão e mostrar nível ------------------
    const micBtn = document.getElementById('micBtn');
    const micBar = document.getElementById('micBar');
    const micMuteBtn = document.getElementById('micMute');
    const micVolumeInput = document.getElementById('micVolume');
    let micStream = null;
    let audioCtx = null;
    let analyser = null;
    let dataArray = null;
    let micAnimationId = null;
    let micGain = null;
    let lastVolume = 1;
    const micOuter = document.querySelector('.mic-outer');
    const micPanelEl = document.querySelector('.mic-panel');
    let bgPos = 0;
    // Sensitivity control (default matches slider default in HTML)
    const micSensitivityInput = document.getElementById('micSensitivity');
    let micSensitivity = micSensitivityInput ? parseFloat(micSensitivityInput.value) : 1.8;
    if (micSensitivityInput) {
        micSensitivityInput.addEventListener('input', (e) => {
            micSensitivity = parseFloat(e.target.value) || 1.0;
        });
    }

    async function startMic() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStream = stream;
            micBtn.classList.add('active');
            micBtn.innerText = 'Ativado';
            console.log('[BROCKER.TV] audioCtx state before resume:', audioCtx ? audioCtx.state : 'no-audioCtx');
            console.log('[BROCKER.TV] Microphone started and graph created');

            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            // resume AudioContext in case it's suspended by browser autoplay policy
            try { if (audioCtx.state === 'suspended') { audioCtx.resume().then(() => console.log('[BROCKER.TV] audioCtx resumed')); } } catch(e){}
            const source = audioCtx.createMediaStreamSource(stream);
            micGain = audioCtx.createGain();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;

            // Conectar: source -> gain -> analyser (não conectar ao destination para não reproduzir)
            source.connect(micGain);
            micGain.connect(analyser);

            dataArray = new Uint8Array(analyser.fftSize);

            // set initial volume from slider
            const vol = micVolumeInput ? (micVolumeInput.value / 100) : 1;
            micGain.gain.value = vol;

            // no mixdown here — keep mic routed to its analyser and controls

            // expose debug handles globally for inspection
            try { window.audioCtx = audioCtx; window.micGain = micGain; window.analyser = analyser; window.micStream = micStream; } catch(e){}
            console.log('[BROCKER.TV] Mic gain value:', micGain.gain.value, 'analyser fftSize:', analyser ? analyser.fftSize : 'no analyser');

            function updateMic() {
                if (!analyser) return;
                analyser.getByteTimeDomainData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    const v = (dataArray[i] - 128) / 128;
                    sum += v * v;
                }
                const rms = Math.sqrt(sum / dataArray.length);
                // apply sensitivity multiplier (controlled by slider)
                const scaledRms = rms * micSensitivity;
                const w = Math.min(220, Math.max(2, Math.round(scaledRms * 700)));
                if (micBar) micBar.style.width = w + 'px';
                // highlight when loud (threshold uses scaledRms)
                if (micBar) {
                    if (scaledRms > 0.14) micBar.classList.add('high'); else micBar.classList.remove('high');
                }
                // Update gradient ripple based on rms: set CSS variables on .mic-outer
                if (micOuter) {
                    const intensity = Math.min(1, scaledRms * 6); // scale to ~0..1 using scaled rms
                    micOuter.style.setProperty('--mic-intensity', intensity);
                    // also set on parent panel so the entire panel pulses
                    if (micPanelEl) micPanelEl.style.setProperty('--mic-intensity', intensity);
                    // advance background position for a moving gradient effect
                    bgPos = (bgPos + intensity * 8) % 100;
                    micOuter.style.setProperty('--mic-bg-pos', bgPos);
                    if (micPanelEl) micPanelEl.style.setProperty('--mic-bg-pos', bgPos);
                }
                micAnimationId = requestAnimationFrame(updateMic);
            }
            updateMic();
        } catch (err) {
            console.error('Erro ao acessar microfone:', err);
            alert('Não foi possível acessar o microfone. Verifique permissões do navegador.');
        }
    }

    function stopMic() {
        try { if (micStream) micStream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} }); } catch (e) {}
        micStream = null;
        if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
        analyser = null; dataArray = null;
        if (micAnimationId) { cancelAnimationFrame(micAnimationId); micAnimationId = null; }
        if (micBar) { micBar.style.width = '2px'; micBar.classList.remove('high'); }
        if (micBtn) { micBtn.innerText = 'Permitir'; micBtn.classList.remove('active'); }
        micGain = null;
    }

    if (micBtn) {
        micBtn.addEventListener('click', async () => {
            if (!micStream) await startMic(); else stopMic();
        });
    }

    // Mute button: toggles gain to 0
    if (micMuteBtn) {
        micMuteBtn.addEventListener('click', () => {
            if (!micGain) return;
            const isMuted = micMuteBtn.getAttribute('aria-pressed') === 'true';
            if (!isMuted) {
                // mute
                lastVolume = micGain.gain.value || lastVolume;
                micGain.gain.value = 0;
                micMuteBtn.setAttribute('aria-pressed', 'true');
                micMuteBtn.classList.add('muted');
                micMuteBtn.innerText = 'Mutado';
            } else {
                // unmute
                micGain.gain.value = lastVolume || 1;
                micMuteBtn.setAttribute('aria-pressed', 'false');
                micMuteBtn.classList.remove('muted');
                micMuteBtn.innerText = 'Silenciar';
            }
        });
    }

    // Volume slider control
    if (micVolumeInput) {
        micVolumeInput.addEventListener('input', (e) => {
            const v = (e.target.value / 100);
            if (micGain) micGain.gain.value = v;
            // update lastVolume for mute toggle
            lastVolume = v;
            // If volume increased above threshold, ensure class updates quickly
        });
    }

    // update visual fill for sliders on init
    if (micVolumeInput) {
        const pct = micVolumeInput.value || 100;
        micVolumeInput.style.setProperty('--vol-percent', pct + '%');
    }
    if (micSensitivityInput) {
        const pct = ((parseFloat(micSensitivityInput.value) - parseFloat(micSensitivityInput.min)) / (parseFloat(micSensitivityInput.max) - parseFloat(micSensitivityInput.min))) * 100;
        micSensitivityInput.style.setProperty('--sens-percent', pct + '%');
    }

    // update slider visuals when changed
    if (micVolumeInput) micVolumeInput.addEventListener('input', (e) => {
        const pct = e.target.value || 0;
        e.target.style.setProperty('--vol-percent', pct + '%');
    });
    if (micSensitivityInput) micSensitivityInput.addEventListener('input', (e) => {
        const min = parseFloat(e.target.min), max = parseFloat(e.target.max), val = parseFloat(e.target.value);
        const pct = ((val - min) / (max - min)) * 100;
        e.target.style.setProperty('--sens-percent', pct + '%');
    });

// ------------------ AUDIO MIXER: captura / microfone / overlay ------------------
// UI elements
const captureVolumeInput = document.getElementById('captureVolume');
const captureMuteBtn = document.getElementById('captureMute');
const captureMeterEl = document.getElementById('captureMeter');

const micVolumeSmall = document.getElementById('micVolumeSmall');
const micMuteSmall = document.getElementById('micMuteSmall');
const micMeterEl = document.getElementById('micMeter');

const overlayVolumeInput = document.getElementById('overlayVolume');
const overlayMuteBtn = document.getElementById('overlayMute');
const overlayMeterEl = document.getElementById('overlayMeter');

// Audio nodes
let captureSource = null, captureGain = null, captureAnalyser = null, captureData = null;
let overlaySource = null, overlayGain = null, overlayAnalyser = null, overlayData = null;
// (mixdown removed) no global audioDestination/mixedStream — mixer controls capture and mic only

// Setup capture audio chain when we have a display stream with audio
function setupCaptureAudio(stream) {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        try { if (audioCtx.state === 'suspended') { audioCtx.resume().then(()=>console.log('[BROCKER.TV] audioCtx resumed for capture')); } } catch(e){}
        // cleanup previous
        if (captureGain) try { captureGain.disconnect(); } catch(e){}
        captureSource = null; captureGain = null; captureAnalyser = null; captureData = null;

        // Only setup if stream has audio track
        if (!stream || !stream.getAudioTracks || stream.getAudioTracks().length === 0) return;
        captureSource = audioCtx.createMediaStreamSource(stream);
        captureGain = audioCtx.createGain();
        captureAnalyser = audioCtx.createAnalyser(); captureAnalyser.fftSize = 256;
        captureSource.connect(captureGain);
            captureGain.connect(captureAnalyser);
            // mark analyser connection to avoid reconnecting later
            try { captureGain._connectedToAnalyser = true; } catch(e){}
        captureData = new Uint8Array(captureAnalyser.fftSize);
        // set initial volume from slider
        if (captureVolumeInput) captureGain.gain.value = (captureVolumeInput.value / 100);

        // no mixdown routing — mixer controls captureGain locally

        // expose debug handles globally for inspection
        try { window.captureGain = captureGain; window.captureAnalyser = captureAnalyser; window.captureSource = captureSource; } catch(e){}

        // If track ends, cleanup
        const t = stream.getAudioTracks()[0];
        if (t) t.onended = () => {
            try { if (captureGain) captureGain.disconnect(); } catch(e){}
            captureSource = null; captureGain = null; captureAnalyser = null; captureData = null;
            if (captureMeterEl) captureMeterEl.style.width = '2%';
        };
        console.log('[BROCKER.TV] Capture audio chain created for stream, audio tracks:', stream.getAudioTracks().map(t=>t.id));
        console.log('[BROCKER.TV] Capture audio chain created for stream, audio tracks:', stream.getAudioTracks().map(t=>t.id));
    } catch (e) {
        console.warn('setupCaptureAudio failed', e);
    }
}

// Volume and mute handlers for capture
if (captureVolumeInput) captureVolumeInput.addEventListener('input', (e) => {
    const v = (e.target.value / 100);
    if (captureGain) captureGain.gain.value = v;
    e.target.style.setProperty('--vol-percent', (e.target.value || 0) + '%');
});
if (captureMuteBtn) captureMuteBtn.addEventListener('click', () => {
    const isMuted = captureMuteBtn.getAttribute('aria-pressed') === 'true';
    if (!captureGain) return;
    if (!isMuted) { captureGain.gain.value = 0; captureMuteBtn.setAttribute('aria-pressed','true'); captureMuteBtn.classList.add('muted'); captureMuteBtn.innerText='Mutado'; }
    else { captureGain.gain.value = (captureVolumeInput ? (captureVolumeInput.value/100) : 1); captureMuteBtn.setAttribute('aria-pressed','false'); captureMuteBtn.classList.remove('muted'); captureMuteBtn.innerText='Mutar'; }
});

// Wire small mic controls to the main micGain (mirror behavior)
if (micVolumeSmall) micVolumeSmall.addEventListener('input', (e) => {
    const v = (e.target.value / 100);
    if (micGain) micGain.gain.value = v;
    // keep main micVolume in sync
    if (micVolumeInput) { micVolumeInput.value = e.target.value; micVolumeInput.style.setProperty('--vol-percent', e.target.value + '%'); }
});
if (micMuteSmall) micMuteSmall.addEventListener('click', () => {
    const isMuted = micMuteSmall.getAttribute('aria-pressed') === 'true';
    if (!micGain) return;
    if (!isMuted) { lastVolume = micGain.gain.value || lastVolume; micGain.gain.value = 0; micMuteSmall.setAttribute('aria-pressed','true'); micMuteSmall.classList.add('muted'); micMuteSmall.innerText='Mutado'; }
    else { micGain.gain.value = lastVolume || 1; micMuteSmall.setAttribute('aria-pressed','false'); micMuteSmall.classList.remove('muted'); micMuteSmall.innerText='Mutar'; }
});

// Overlay controls (no overlay stream by default)
if (overlayVolumeInput) overlayVolumeInput.addEventListener('input', (e) => {
    const v = (e.target.value / 100);
    if (overlayGain) overlayGain.gain.value = v;
});
if (overlayMuteBtn) overlayMuteBtn.addEventListener('click', () => {
    const isMuted = overlayMuteBtn.getAttribute('aria-pressed') === 'true';
    if (!overlayGain) return;
    if (!isMuted) { overlayGain.gain.value = 0; overlayMuteBtn.setAttribute('aria-pressed','true'); overlayMuteBtn.classList.add('muted'); overlayMuteBtn.innerText='Mutado'; }
    else { overlayGain.gain.value = (overlayVolumeInput ? (overlayVolumeInput.value/100) : 1); overlayMuteBtn.setAttribute('aria-pressed','false'); overlayMuteBtn.classList.remove('muted'); overlayMuteBtn.innerText='Mutar'; }
});

// Meter update loop (reads analysers and updates meter fills)
function updateMixerMeters() {
    // capture
    if (captureAnalyser && captureData) {
        captureAnalyser.getByteTimeDomainData(captureData);
        let sum = 0; for (let i=0;i<captureData.length;i++){ const v=(captureData[i]-128)/128; sum += v*v; }
        const rms = Math.sqrt(sum / captureData.length);
        const pct = Math.min(100, Math.round(rms * 300));
        if (captureMeterEl) captureMeterEl.style.width = pct + '%';
    }
    // mic (mirror into micMeterEl using existing analyser/dataArray)
    if (analyser && dataArray && micMeterEl) {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0; for (let i=0;i<dataArray.length;i++){ const v=(dataArray[i]-128)/128; sum += v*v; }
        const rms = Math.sqrt(sum / dataArray.length);
        const pct = Math.min(100, Math.round(rms * 300));
        micMeterEl.style.width = pct + '%';
    }
    // overlay
    if (overlayAnalyser && overlayData) {
        overlayAnalyser.getByteTimeDomainData(overlayData);
        let sum = 0; for (let i=0;i<overlayData.length;i++){ const v=(overlayData[i]-128)/128; sum += v*v; }
        const rms = Math.sqrt(sum / overlayData.length);
        const pct = Math.min(100, Math.round(rms * 300));
        if (overlayMeterEl) overlayMeterEl.style.width = pct + '%';
    }
    requestAnimationFrame(updateMixerMeters);
}
requestAnimationFrame(updateMixerMeters);

    // ------------------ Elementos relacionados ao início da transmissão e credenciais
const streamKeyInput = document.getElementById('streamKey');
const streamPasswordInput = document.getElementById('streamPassword');

// Editable title elements
const liveTitleDisplay = document.getElementById('liveTitleDisplay');
const liveTitleInput = document.getElementById('liveTitle');
let caretColorInterval = null;
const caretColors = ['#6441A5','#1b6fff','#ff0000','#00e676']; // roxo, azul, vermelho, verde

function startCaretCycle(input) {
    stopCaretCycle();
    let i = 0;
    // Ensure caret visible by setting caretColor repeatedly
    caretColorInterval = setInterval(() => {
        try { input.style.caretColor = caretColors[i % caretColors.length]; } catch (e) {}
        i++;
    }, 180);
}
function stopCaretCycle() {
    if (caretColorInterval) { clearInterval(caretColorInterval); caretColorInterval = null; }
}

// Enable editing when display clicked or focused+Enter
if (liveTitleDisplay && liveTitleInput) {
    function enableTitleEdit() {
        liveTitleInput.value = liveTitleDisplay.innerText === 'Qual o título da sua live?' ? '' : liveTitleDisplay.innerText;
        liveTitleDisplay.style.display = 'none';
        liveTitleInput.classList.add('editing');
        liveTitleInput.style.display = 'block';
        liveTitleInput.focus();
        // place caret at end
        const len = liveTitleInput.value.length;
        liveTitleInput.setSelectionRange(len, len);
        startCaretCycle(liveTitleInput);
    }
    function disableTitleEdit(save) {
        stopCaretCycle();
        liveTitleInput.classList.remove('editing');
        liveTitleInput.style.display = 'none';
        let text = save ? liveTitleInput.value.trim() : liveTitleDisplay.innerText;
        if (!text) text = 'Qual o título da sua live?';
        liveTitleDisplay.innerText = text;
        liveTitleDisplay.style.display = 'inline';
    }

    liveTitleDisplay.addEventListener('click', () => { enableTitleEdit(); });
    liveTitleDisplay.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enableTitleEdit(); } });

    liveTitleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            disableTitleEdit(true);
            // move focus away
            liveTitleInput.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            disableTitleEdit(false);
            liveTitleInput.blur();
        }
    });

    // clicking outside should save and lock
    document.addEventListener('click', (e) => {
        if (!liveTitleInput.contains(e.target) && !liveTitleDisplay.contains(e.target)) {
            if (liveTitleInput.classList.contains('editing')) disableTitleEdit(true);
        }
    });
}

// Botão ver transmissão (abre popup com preview)
const btnView = document.getElementById('btnView');
if (btnView) {
    btnView.addEventListener('click', () => {
        const popup = window.open('', 'ver-transmissao', 'width=960,height=540');
        if (!popup) return alert('Bloqueador de popups ativado. Permita popups para ver a transmissão.');
        popup.document.body.style.margin = '0';
        popup.document.body.style.background = '#000';
        popup.document.title = 'Visualizando transmissão';

        if (lastDisplayStream) {
            const video = popup.document.createElement('video');
            video.autoplay = true; video.controls = true; video.style.width = '100%'; video.style.height = '100%';
            video.srcObject = lastDisplayStream;
            popup.document.body.appendChild(video);
        } else {
            const msg = popup.document.createElement('div');
            msg.style.color = '#fff'; msg.style.padding = '20px'; msg.innerText = 'Nenhuma transmissão disponível. Selecione "Janela do jogo" primeiro.';
            popup.document.body.appendChild(msg);
        }
    });
}

// Botão iniciar / transmitir: se já temos stream, inicia; se não, pede para selecionar
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');

// Nome da plataforma conectada (ou null)
let platformConnectedName = null;

// Avalia se o botão Transmitir deve ser habilitado
function evaluateStartButtonState() {
    if (!btnStart) return;
    const hasPlatform = !!platformConnectedName;
    const hasKeyAndPass = streamKeyInput && streamPasswordInput && streamKeyInput.value.trim() !== '' && streamPasswordInput.value.trim() !== '';
    const ready = hasPlatform || hasKeyAndPass;
    btnStart.disabled = !ready;
    if (ready) btnStart.classList.add('ready'); else btnStart.classList.remove('ready');
}

// Monitora mudanças nas credenciais para atualizar estado do botão
if (streamKeyInput) streamKeyInput.addEventListener('input', evaluateStartButtonState);
if (streamPasswordInput) streamPasswordInput.addEventListener('input', evaluateStartButtonState);

if (btnStart) {
    btnStart.addEventListener('click', async () => {
        if (!streaming) {
            if (lastDisplayStream) {
                startTransmission(lastDisplayStream);
                // mostra botão Encerrar quando transmissão inicia (Pause está desativado)
                if (btnStop) { btnStop.style.display = 'inline-block'; }
            } else {
                // Força o seletor de tela caso o usuário não tenha escolhido ainda
                if (selectBtn) selectBtn.click();
            }
        } else {
            // Se já estiver transmitindo, clique no botão trata como parar
            stopTransmission();
            if (btnStop) { btnStop.style.display = 'none'; }
        }
    });
}

if (btnStop) {
    btnStop.addEventListener('click', () => {
        stopTransmission();
        if (btnStop) { btnStop.style.display = 'none'; }
    });
}
// NOTE: O botão Pausar foi desativado conforme solicitado (removido do layout).

// ------------------ TAGS (separar por vírgula) ------------------

const tagsInput = document.getElementById('tags');
const tagsContainer = document.getElementById('tagsContainer');
let tags = [];

function renderTags() {
    if (!tagsContainer) return;
    tagsContainer.innerHTML = '';
    tags.forEach((t, i) => {
        const el = document.createElement('div');
        el.className = 'tag-chip';
        el.innerText = t.trim();
        el.title = 'Clique para remover';
        el.addEventListener('click', () => {
            tags.splice(i, 1);
            renderTags();
        });
        tagsContainer.appendChild(el);
    });
}

function addTagsFromString(s) {
    if (!s) return;
    const parts = s.split(',').map(p => p.trim()).filter(p => p.length > 0);
    parts.forEach(p => { if (!tags.includes(p)) tags.push(p); });
    renderTags();
}

if (tagsInput) {
    // Quando o usuário pressiona vírgula ou Enter, converte em chips
    tagsInput.addEventListener('keydown', (e) => {
        if (e.key === ',' || e.key === 'Enter') {
            e.preventDefault();
            addTagsFromString(tagsInput.value);
            tagsInput.value = '';
        }
    });
    // Ao perder o foco, também processa o conteúdo
    tagsInput.addEventListener('blur', () => {
        addTagsFromString(tagsInput.value);
        tagsInput.value = '';
    });
}

// ------------------ PLATAFORMA: ao clicar em conectar, abrir modal para inserir ID/ClientID ------------------

const platformButtons = document.querySelectorAll('.connect-twitch, .connect-yt, .connect-steam, .connect-kick');
const platformModal = document.getElementById('platformConnectModal');
const platformNameEl = document.getElementById('platformConnectName');
const platformUserIdInput = document.getElementById('platformUserIdInput');
const platformClientIdInput = document.getElementById('platformClientIdInput');
const platformSaveBtn = document.getElementById('platformSaveBtn');

function getCurrentUserId() {
    // prefer explicit logged-in user id if set by login flow
    try { if (window.loggedInUserId) return String(window.loggedInUserId); } catch(e){}
    const handleEl = document.querySelector('.profile-card .handle');
    if (handleEl && handleEl.innerText) return handleEl.innerText.replace(/^@/, '').trim();
    const btn = document.getElementById('profileBtn');
    if (btn && btn.innerText) return btn.innerText.replace(/\s*▾$/, '').trim();
    return 'guest';
}

function userStorageKey(userId) { return `brocker:user:${userId}`; }
function userAccountsKey(userId) { return `brocker:accounts:${userId}`; }

// Frontend helper: register local user via backend
window.registerLocal = async function(username, email, password) {
    try {
        const resp = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ username, email, password }) });
        if (!resp.ok) {
            const j = await resp.json().catch(()=>({}));
            throw new Error(j && j.error ? j.error : 'Failed to register');
        }
        const j = await resp.json();
        if (j && j.user) {
            window.loggedInUserId = j.user.id;
            // update UI profile button if present
            const btn = document.getElementById('profileBtn'); if (btn) btn.innerText = `${j.user.username} ▾`;
            return j.user;
        }
        return null;
    } catch (e) { console.warn('registerLocal failed', e); throw e; }
};

// Frontend helper: login local user
window.loginLocal = async function(username, password) {
    try {
        const resp = await fetch('/api/users/login', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ username, password }) });
        if (!resp.ok) { const j = await resp.json().catch(()=>({})); throw new Error(j && j.error ? j.error : 'Login failed'); }
        const j = await resp.json(); if (j && j.user) { window.loggedInUserId = j.user.id; const btn = document.getElementById('profileBtn'); if (btn) btn.innerText = `${j.user.username} ▾`; return j.user; } return null;
    } catch (e) { console.warn('loginLocal failed', e); throw e; }
};

// Frontend helper: start provider registration flow (opens OAuth URL with intent=register)
// Robust provider auth starter. Accepts 'google' as alias for YouTube.
window.startProviderAuth = async function(provider, intent = 'register') {
    // provider: 'twitch' | 'youtube' | 'google' | 'steam'
    const map = { google: 'youtube', youtube: 'youtube', twitch: 'twitch', steam: 'steam' };
    const endpoint = map[provider] || provider;
    try {
        const uid = getCurrentUserId ? getCurrentUserId() : 'guest';
        // try standard endpoint first
        let url = `/auth/${encodeURIComponent(endpoint)}/url?intent=${encodeURIComponent(intent)}&user=${encodeURIComponent(uid)}`;
        let resp = await fetch(url);
        if (!resp.ok) {
            // If provider was 'google', try 'google' endpoint too; if 'youtube' try 'google' as alias
            if (endpoint === 'youtube') {
                try {
                    resp = await fetch(`/auth/google/url?intent=${encodeURIComponent(intent)}&user=${encodeURIComponent(uid)}`);
                } catch (e) { /* ignore */ }
            }
        }
        if (resp && resp.ok) {
            const j = await resp.json();
            if (j && j.url) {
                window.open(j.url, '_blank');
                return j.url;
            }
        }
        throw new Error('Failed to get auth url');
    } catch (e) { console.warn('startProviderAuth failed', e); throw e; }
};

function loadUserState(userId) {
    try {
        // synchronous local fallback
        const s = localStorage.getItem(userStorageKey(userId));
        const local = s ? JSON.parse(s) : null;
        // async: attempt to fetch authoritative state from backend and update UI when available
        (async () => {
            try {
                const resp = await fetch(`/api/user/${encodeURIComponent(userId)}/state`);
                if (resp && resp.ok) {
                    const j = await resp.json();
                    if (j && j.state) {
                        // update localStorage and UI
                        try { localStorage.setItem(userStorageKey(userId), JSON.stringify(j.state)); } catch(e){}
                        xp = typeof j.state.xp === 'number' ? j.state.xp : xp;
                        xpMax = typeof j.state.xpMax === 'number' ? j.state.xpMax : xpMax;
                        level = typeof j.state.level === 'number' ? j.state.level : level;
                        updateXpUI();
                    }
                }
            } catch (e) { /* ignore backend errors */ }
        })();
        return local;
    } catch (e) { return null; }
}
function saveUserState(userId, state) {
    try { localStorage.setItem(userStorageKey(userId), JSON.stringify(state)); } catch (e) { console.warn('saveUserState failed', e); }
    // async send to backend (best-effort)
    try {
        fetch(`/api/user/${encodeURIComponent(userId)}/state`, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(state) }).catch(e => console.warn('saveUserState backend failed', e));
    } catch (e) { console.warn('saveUserState post err', e); }
}

function loadAccounts(userId) {
    try { const s = localStorage.getItem(userAccountsKey(userId)); return s ? JSON.parse(s) : {}; } catch (e) { return {}; }
}
function saveAccounts(userId, accounts) {
    try { localStorage.setItem(userAccountsKey(userId), JSON.stringify(accounts)); } catch (e) { console.warn('saveAccounts failed', e); }
}

// Guard: se elementos do modal não existem, skip e loga aviso
if (!platformModal || !platformNameEl || !platformUserIdInput || !platformClientIdInput) {
    console.warn('[BROCKER.TV] platform connect modal elements missing — platform connect disabled');
} else {
    platformButtons.forEach(btn => {
        try {
            btn.addEventListener('click', async (e) => {
                // Detecta a plataforma e uma chave curta para classes
                let name = '—';
                let key = '';
                if (btn.classList.contains('connect-twitch')) { name = 'Twitch'; key = 'twitch'; }
                if (btn.classList.contains('connect-yt')) { name = 'YouTube'; key = 'youtube'; }
                if (btn.classList.contains('connect-steam')) { name = 'Steam'; key = 'steam'; }
                if (btn.classList.contains('connect-kick')) { name = 'Kick'; key = 'kick'; }
                // primeiro, tenta abrir o fluxo OAuth no backend para plataformas suportadas
                const userId = getCurrentUserId();
                if (['twitch','youtube','steam'].includes(key)) {
                    try {
                        const resp = await fetch(`/auth/${key}/url?user=${encodeURIComponent(userId)}`);
                        if (resp && resp.ok) {
                            const data = await resp.json();
                            if (data && data.url) {
                                window.open(data.url, '_blank');
                                e.stopPropagation();
                                return;
                            }
                        }
                    } catch (err) {
                        console.warn('[BROCKER.TV] oauth url fetch failed, falling back to manual modal', err);
                    }
                }

                // fallback: preenche modal com dados existentes (por usuário logado)
                const accounts = loadAccounts(userId);
                platformModal.dataset.platform = key;
                platformNameEl.innerText = name;
                platformUserIdInput.value = accounts && accounts[key] && accounts[key].userId ? accounts[key].userId : '';
                platformClientIdInput.value = accounts && accounts[key] && accounts[key].clientId ? accounts[key].clientId : '';

                openModal('platformConnectModal');
                e.stopPropagation();
            });
        } catch (err) {
            console.error('[BROCKER.TV] error attaching platform button handler', err);
        }
    });
}
        

// Salvar dados da plataforma para o usuário atual
if (platformSaveBtn) {
    platformSaveBtn.addEventListener('click', () => {
        try {
            const key = platformModal && platformModal.dataset ? platformModal.dataset.platform : null;
            if (!key) return;
            const uid = getCurrentUserId();
            const accounts = loadAccounts(uid) || {};
            const enteredId = (platformUserIdInput && platformUserIdInput.value) ? platformUserIdInput.value.trim() : '';
            const enteredClient = (platformClientIdInput && platformClientIdInput.value) ? platformClientIdInput.value.trim() : '';
            accounts[key] = { userId: enteredId, clientId: enteredClient, savedAt: Date.now() };
            saveAccounts(uid, accounts);

            // update UI similar to previous behavior: connectedChip + platformInfo
            const classSuffix = key === 'youtube' ? 'yt' : key;
            const srcBtn = document.querySelector('.connect-' + classSuffix);
            let logoSrc = '';
            if (srcBtn) {
                const img = srcBtn.querySelector('img');
                if (img) logoSrc = img.src || img.getAttribute('src') || '';
            }

            if (connectedChip) {
                connectedChip.classList.remove('platform-twitch','platform-yt','platform-steam','platform-kick');
                connectedChip.classList.add('platform-' + key);
                if (logoSrc) connectedChip.innerHTML = `<img class="connected-logo" src="${logoSrc}" alt="${key} logo">Conectado: ${key}`;
                else connectedChip.innerText = `Conectado: ${key}`;
            }
            if (platformInfoEl) platformInfoEl.innerText = `Plataforma: ${key}`;
            platformConnectedName = key;
            evaluateStartButtonState();

            platformButtons.forEach(b => b.classList.remove('active-platform'));
            if (srcBtn) srcBtn.classList.add('active-platform');

            closeModal('platformConnectModal');
        } catch (err) {
            console.error('[KYVOTV] error saving platform data', err);
        }
    });
}

// ------------------ ACCOUNTS RENDER / REMOVE ------------------
async function renderAccounts() {
    try {
        const uid = getCurrentUserId();
        const container = document.getElementById('accountsList');
        if (!container) return;
        container.innerHTML = '';
        // try backend first
        try {
            const resp = await fetch(`/api/user/${encodeURIComponent(uid)}/accounts`);
            if (resp && resp.ok) {
                const data = await resp.json();
                const rows = data.accounts || [];
                if (rows.length === 0) { container.innerHTML = '<div class="muted">Nenhuma conta conectada.</div>'; return; }
                rows.forEach(r => {
                    const k = r.platform;
                    const a = r;
                    const row = document.createElement('div'); row.className = 'account-row';
                    const meta = document.createElement('div'); meta.className = 'account-meta';
                    const img = document.createElement('img');
                    // try to reuse logo on page (and preload to detect broken images)
                    const btn = document.querySelector('.connect-' + (k === 'youtube' ? 'yt' : k));
                    const logo = btn && btn.querySelector('img') ? (btn.querySelector('img').src || '') : '';
                    const defaultSvg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect rx="6" width="100%" height="100%" fill="#111"/><text x="50%" y="58%" font-size="18" fill="#fff" text-anchor="middle" font-family="Inter, Arial">? </text></svg>');
                    if (logo) {
                        // preload
                        const test = new Image();
                        test.onload = () => { img.src = logo; };
                        test.onerror = () => { img.src = defaultSvg; };
                        try { test.src = logo; } catch(e) { img.src = defaultSvg; }
                    } else {
                        img.src = defaultSvg;
                    }
                    const info = document.createElement('div'); info.className = 'account-info';
                    const platform = document.createElement('div'); platform.className = 'platform'; platform.innerText = k.charAt(0).toUpperCase() + k.slice(1);
                    const user = document.createElement('div'); user.className = 'user'; user.innerText = a.platform_userid || '(sem id)';
                    info.appendChild(platform); info.appendChild(user);
                    meta.appendChild(img); meta.appendChild(info);

                    const actions = document.createElement('div'); actions.className = 'account-actions';
                    const removeBtn = document.createElement('button'); removeBtn.className = 'account-remove-btn'; removeBtn.innerText = 'Remover';
                    removeBtn.addEventListener('click', async () => { await removeAccount(k); });
                    actions.appendChild(removeBtn);

                    row.appendChild(meta);
                    row.appendChild(actions);
                    container.appendChild(row);
                });
                return;
            }
        } catch (e) { console.warn('backend accounts fetch failed, falling back to local', e); }

        // fallback to localStorage
        const accounts = loadAccounts(uid) || {};
        const keys = Object.keys(accounts);
        if (keys.length === 0) { container.innerHTML = '<div class="muted">Nenhuma conta conectada.</div>'; return; }
        keys.forEach(k => {
            const a = accounts[k];
            const row = document.createElement('div'); row.className = 'account-row';
            const meta = document.createElement('div'); meta.className = 'account-meta';
            const img = document.createElement('img');
            const btn = document.querySelector('.connect-' + (k === 'youtube' ? 'yt' : k));
            const logo = btn && btn.querySelector('img') ? (btn.querySelector('img').src || '') : '';
            const defaultSvg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect rx="6" width="100%" height="100%" fill="#111"/><text x="50%" y="58%" font-size="18" fill="#fff" text-anchor="middle" font-family="Inter, Arial">? </text></svg>');
            if (logo) {
                const test = new Image();
                test.onload = () => { img.src = logo; };
                test.onerror = () => { img.src = defaultSvg; };
                try { test.src = logo; } catch(e) { img.src = defaultSvg; }
            } else {
                img.src = defaultSvg;
            }
            const info = document.createElement('div'); info.className = 'account-info';
            const platform = document.createElement('div'); platform.className = 'platform'; platform.innerText = k.charAt(0).toUpperCase() + k.slice(1);
            const user = document.createElement('div'); user.className = 'user'; user.innerText = a.userId || '(sem id)';
            info.appendChild(platform); info.appendChild(user);
            meta.appendChild(img); meta.appendChild(info);

            const actions = document.createElement('div'); actions.className = 'account-actions';
            const removeBtn = document.createElement('button'); removeBtn.className = 'account-remove-btn'; removeBtn.innerText = 'Remover';
            removeBtn.addEventListener('click', () => { removeAccount(k); });
            actions.appendChild(removeBtn);

            row.appendChild(meta);
            row.appendChild(actions);
            container.appendChild(row);
        });
    } catch (e) { console.error('[KYVOTV] renderAccounts failed', e); }
}

async function removeAccount(platformKey) {
    try {
        const uid = getCurrentUserId();
        // try backend delete first
        try {
            const resp = await fetch(`/api/user/${encodeURIComponent(uid)}/accounts/${encodeURIComponent(platformKey)}`, { method: 'DELETE' });
            if (resp && resp.ok) {
                const j = await resp.json();
                if (j.deleted) {
                    // re-render
                    await renderAccounts();
                    if (platformConnectedName === platformKey) {
                        platformConnectedName = null;
                        if (connectedChip) connectedChip.innerText = 'Conectado: —';
                        if (platformInfoEl) platformInfoEl.innerText = 'Plataforma: —';
                        evaluateStartButtonState();
                    }
                    return;
                }
            }
        } catch (e) { console.warn('backend delete failed, falling back to local', e); }

        // fallback: localStorage
        const accounts = loadAccounts(uid) || {};
        if (!accounts[platformKey]) return;
        delete accounts[platformKey];
        saveAccounts(uid, accounts);
        await renderAccounts();
        if (platformConnectedName === platformKey) {
            platformConnectedName = null;
            if (connectedChip) connectedChip.innerText = 'Conectado: —';
            if (platformInfoEl) platformInfoEl.innerText = 'Plataforma: —';
            evaluateStartButtonState();
        }
    } catch (e) { console.error('[KYVOTV] removeAccount failed', e); }
}

// Image fallback for Kick (and generic logos) — try alternatives if the image fails to load
document.querySelectorAll('.auth-row img').forEach(img => {
    img.addEventListener('error', function handler() {
        // if we have an alt-list saved, use it; otherwise build alternatives
        let altList = img.dataset.altList ? img.dataset.altList.split('|') : null;
        let idx = parseInt(img.dataset.altIndex || '0', 10);
        if (!altList) {
            const src = img.getAttribute('src') || '';
            const alts = [];
            if (src.includes('kick')) {
                // prefer webp first (we have kick.webp in assets)
                alts.push('assets/images/kick.webp', 'assets/images/kick.png', 'assets/images/kick.svg');
            }
            if (src.includes('youtube')) alts.push('assets/images/youtube.png', 'assets/images/youtube.svg');
            if (src.includes('twitch')) alts.push('assets/images/twitch.png', 'assets/images/twitch.svg');
            if (src.includes('steam')) alts.push('assets/images/steam.png', 'assets/images/steam.svg');
            // generic fallback
            alts.push('assets/images/kyvo.png');
            img.dataset.altList = alts.join('|');
            altList = alts;
            idx = 0;
        }

        if (idx < altList.length) {
            const next = altList[idx];
            img.dataset.altIndex = idx + 1;
            // temporarily remove this handler to avoid recursion during src set
            img.removeEventListener('error', handler);
            // attach a one-time load handler to clean alt data
            const onload = function() {
                delete img.dataset.altList; delete img.dataset.altIndex;
                img.removeEventListener('load', onload);
            };
            img.addEventListener('load', onload);
            img.src = next;
            // reattach error handler shortly to try next alternative if this fails
            setTimeout(() => { img.addEventListener('error', handler); }, 50);
        } else {
            // no alternatives left — set an inline SVG placeholder with a 'K' letter
            img.removeEventListener('error', handler);
            const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><rect rx='8' width='100%' height='100%' fill='#111'/><text x='50%' y='58%' font-size='28' fill='#fff' text-anchor='middle' font-family='Inter, Arial'>K</text></svg>`;
            img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
        }
    });
});

// ------------------ PROFILE BUTTON -> abre o modal de perfil ------------------

const profileBtn = document.getElementById('profileBtn');
if (profileBtn) {
    profileBtn.addEventListener('click', (e) => {
        // Antes de abrir, tenta carregar estado do usuário (XP salvo)
        try {
            const uid = (typeof getCurrentUserId === 'function') ? getCurrentUserId() : null;
            if (uid) {
                const state = loadUserState(uid);
                if (state) {
                    xp = typeof state.xp === 'number' ? state.xp : xp;
                    xpMax = typeof state.xpMax === 'number' ? state.xpMax : xpMax;
                    level = typeof state.level === 'number' ? state.level : level;
                }
                updateXpUI();
            }
        } catch (err) { console.warn('Erro ao carregar estado do usuário:', err); }
        // Abre o modal principal de perfil que contém as ações (Gerenciar, Configurações, Contas, Acessar canal)
        openModal('profileModal');
        e.stopPropagation();
    });
}

// Wire profile modal action buttons
const btnAccessChannel = document.getElementById('btnAccessChannel');
const menuManageProfile = document.getElementById('menuManageProfile');
const menuConnectedAccounts = document.getElementById('menuConnectedAccounts');
const menuLogout = document.getElementById('menuLogout');
const menuSettings = document.getElementById('menuSettings');
if (btnAccessChannel) btnAccessChannel.addEventListener('click', () => { openModal('channelModal'); });
if (menuManageProfile) menuManageProfile.addEventListener('click', () => { openModal('manageProfileModal'); });
if (menuConnectedAccounts) menuConnectedAccounts.addEventListener('click', async () => { await renderAccounts(); openModal('accountsModal'); });
if (menuSettings) menuSettings.addEventListener('click', () => { openModal('settingsModal'); });
if (menuLogout) menuLogout.addEventListener('click', () => { closeModal('profileModal'); /* extend with logout flow if needed */ });

// Logout: call backend to clear session cookie and update UI
async function doLogout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) { console.warn('logout request failed', e); }
    // clear client state
    try { window.loggedInUserId = null; } catch(e){}
    const btn = document.getElementById('profileBtn'); if (btn) btn.innerText = 'Convidado ▾';
    const authLogin = document.getElementById('authLoginBtn'); const authReg = document.getElementById('authRegisterBtn');
    if (authLogin) authLogin.style.display = 'inline-block'; if (authReg) authReg.style.display = 'inline-block';
    try { renderAccounts(); } catch(e){}
}
if (menuLogout) menuLogout.addEventListener('click', () => { doLogout(); closeModal('profileModal'); });

// --- AUTH: abrir modais de login / cadastro e tratar formulários ---
const authLoginBtn = document.getElementById('authLoginBtn');
const authRegisterBtn = document.getElementById('authRegisterBtn');
const loginSubmit = document.getElementById('loginSubmit');
const registerSubmit = document.getElementById('registerSubmit');
const loginUsername = document.getElementById('loginUsername');
const loginPassword = document.getElementById('loginPassword');
const registerUsername = document.getElementById('registerUsername');
const registerEmail = document.getElementById('registerEmail');
const registerPassword = document.getElementById('registerPassword');
const loginError = document.getElementById('loginError');
const registerError = document.getElementById('registerError');

if (authLoginBtn) authLoginBtn.addEventListener('click', (e) => { openModal('loginModal'); e.stopPropagation(); });
if (authRegisterBtn) authRegisterBtn.addEventListener('click', (e) => { openModal('registerModal'); e.stopPropagation(); });

if (loginSubmit) loginSubmit.addEventListener('click', async (e) => {
    e.preventDefault();
    if (loginError) { loginError.style.display = 'none'; loginError.innerText = ''; }
    const u = loginUsername ? loginUsername.value.trim() : '';
    const p = loginPassword ? loginPassword.value : '';
    if (!u || !p) { if (loginError) { loginError.style.display='block'; loginError.innerText='Preencha usuário e senha.'; } return; }
    try {
        const user = await window.loginLocal(u, p);
        // successful
        closeModal('loginModal');
        // load state and accounts
        try { loadUserState(String(user.id)); } catch(e){}
        try { renderAccounts(); } catch(e){}
    } catch (err) {
        console.warn('login failed', err);
        if (loginError) { loginError.style.display='block'; loginError.innerText = err && err.message ? err.message : 'Erro ao entrar'; }
    }
});

if (registerSubmit) registerSubmit.addEventListener('click', async (e) => {
    e.preventDefault();
    if (registerError) { registerError.style.display = 'none'; registerError.innerText = ''; }
    const u = registerUsername ? registerUsername.value.trim() : '';
    const em = registerEmail ? registerEmail.value.trim() : '';
    const p = registerPassword ? registerPassword.value : '';
    if (!u || !em || !p) { if (registerError) { registerError.style.display='block'; registerError.innerText='Preencha todos os campos.'; } return; }
    try {
        const user = await window.registerLocal(u, em, p);
        closeModal('registerModal');
        try { loadUserState(String(user.id)); } catch(e){}
        try { renderAccounts(); } catch(e){}
    } catch (err) {
        console.warn('register failed', err);
        if (registerError) { registerError.style.display='block'; registerError.innerText = err && err.message ? err.message : 'Erro ao cadastrar'; }
    }
});

// Provider buttons in login/register modal
const loginTwitch = document.getElementById('loginTwitch');
const loginGoogle = document.getElementById('loginGoogle');
const registerTwitch = document.getElementById('registerTwitch');
const registerGoogle = document.getElementById('registerGoogle');
if (loginTwitch) loginTwitch.addEventListener('click', () => { window.startProviderAuth('twitch', 'login'); });
if (loginGoogle) loginGoogle.addEventListener('click', () => { window.startProviderAuth('google', 'login'); });
if (registerTwitch) registerTwitch.addEventListener('click', () => { window.startProviderAuth('twitch', 'register'); });
if (registerGoogle) registerGoogle.addEventListener('click', () => { window.startProviderAuth('google', 'register'); });

// Modal helpers
function openModal(id) {
    const overlay = document.getElementById('modalOverlay');
    if (!overlay) return;
    // hide all modals, then show overlay and target
    overlay.setAttribute('aria-hidden', 'false');
    // mark visible modal
    const modals = overlay.querySelectorAll('.modal');
    modals.forEach(m => m.style.display = 'none');
    const target = document.getElementById(id);
    if (target) target.style.display = 'block';
}
function closeModal(id) {
    const overlay = document.getElementById('modalOverlay');
    if (!overlay) return;
    const target = document.getElementById(id);
    if (target) target.style.display = 'none';
    // if no modal visible, hide overlay
    const anyVisible = Array.from(overlay.querySelectorAll('.modal')).some(m => m.style.display === 'block');
    if (!anyVisible) overlay.setAttribute('aria-hidden', 'true');
}

// wire modal close buttons
document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.modal-close');
    if (btn) {
        const id = btn.getAttribute('data-close');
        if (id) closeModal(id);
    }
});

// ESC closes any modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const overlay = document.getElementById('modalOverlay');
        if (overlay) overlay.setAttribute('aria-hidden', 'true');
        const modals = document.querySelectorAll('.modal'); modals.forEach(m => m.style.display = 'none');
    }
});

// (settings modal wiring handled with profile modal buttons)

// Generic info modal helper used by top-nav links
function openInfoModal(title, bodyHtml) {
    const infoTitle = document.getElementById('infoModalTitle');
    const infoBody = document.getElementById('infoModalBody');
    if (infoTitle) infoTitle.innerText = title;
    if (infoBody) infoBody.innerHTML = bodyHtml;
    openModal('infoModal');
}

// Wire top nav info links to open a small info modal with explanatory text
document.querySelectorAll('a.info-link').forEach(a => {
    a.addEventListener('click', (e) => {
        e.preventDefault();
        const which = a.dataset.info;
        if (!which) return;
        if (which === 'documents') {
            openInfoModal('Documentos', '<p>Guia rápido e documentação para configurar transmissões, usar a stream key e dicas de resolução/performance.</p>');
        } else if (which === 'github') {
            openInfoModal('Github', '<p>Repositório do projeto KYVO.TV com instruções de contribuição, issues e histórico de mudanças.</p>');
        } else if (which === 'company') {
            openInfoModal('Empresa', '<p>Informações sobre a equipe KYVO, contatos comerciais e oportunidades de parceria.</p>');
        } else if (which === 'resources') {
            openInfoModal('Recursos', '<p>Links úteis: guias, assets, padrões de stream e ferramentas recomendadas para transmissão.</p>');
        } else {
            openInfoModal('Informação', '<p>Informação não disponível.</p>');
        }
    });
});

// XP modal from label
const xpLabelEl = document.getElementById('xpLabel');
if (xpLabelEl) xpLabelEl.addEventListener('click', () => openModal('xpModal'));

// ------------------ INICIALIZAÇÃO: valores iniciais em Português ------------------
updateStats('—', '—');
if (platformInfoEl) platformInfoEl.innerText = 'Plataforma: —';
// Avalia estado inicial do botão Transmitir
evaluateStartButtonState();

// On page load, try to detect logged-in user via backend cookie session
// migrate old localStorage keys (kyvotv:...) to new brocker:... keys
function migrateLocalStorage() {
    try {
        // migrate user state keys
        for (const key of Object.keys(localStorage)) {
            if (!key) continue;
            if (key.startsWith('kyvotv:user:')) {
                const newKey = key.replace('kyvotv:user:', 'brocker:user:');
                if (!localStorage.getItem(newKey)) {
                    try { localStorage.setItem(newKey, localStorage.getItem(key)); } catch(e){}
                }
            }
            if (key.startsWith('kyvotv:accounts:')) {
                const newKey = key.replace('kyvotv:accounts:', 'brocker:accounts:');
                if (!localStorage.getItem(newKey)) {
                    try { localStorage.setItem(newKey, localStorage.getItem(key)); } catch(e){}
                }
            }
        }
    } catch (e) { console.warn('[BROCKER.TV] localStorage migration failed', e); }
}

(async function detectSession() {
    try { migrateLocalStorage(); } catch(e){}
    try {
        const resp = await fetch('/api/me');
        if (resp && resp.ok) {
            const j = await resp.json();
            if (j && j.user) {
                window.loggedInUserId = String(j.user.id);
                const btn = document.getElementById('profileBtn'); if (btn) btn.innerText = `${j.user.username} ▾`;
                const authLogin = document.getElementById('authLoginBtn'); const authReg = document.getElementById('authRegisterBtn');
                if (authLogin) authLogin.style.display = 'none'; if (authReg) authReg.style.display = 'none';
                // load server-side state and accounts
                try { loadUserState(String(j.user.id)); } catch(e){}
                try { renderAccounts(); } catch(e){}
            }
        }
    } catch (e) { /* ignore */ }
})();
