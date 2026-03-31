const { spawn, exec } = require('child_process');
    const path = require('path');
    const os = require('os');
    const { ipcRenderer } = require('electron');
    let ffmpegPath = '';
    try {
      ffmpegPath = require('ffmpeg-static');
    } catch (e) {
      ffmpegPath = 'ffmpeg';
    }

    let files = [], ctr = 0;
    const $ = id => document.getElementById(id);

    window.updateSlider = function (val) {
      const pct = Math.round(((51 - val) / 51) * 100);
      document.getElementById('crf-val').textContent = pct + '%';
      const hue = 120 - (val / 51) * 120;
      const color = `hsl(${hue}, 100%, 60%)`;
      const glow = `hsl(${hue}, 100%, 60%, 0.4)`;
      const slider = document.getElementById('crf');
      slider.style.setProperty('--slider-color', color);
      slider.style.setProperty('--slider-glow', glow);
      document.getElementById('crf-val').style.color = color;
      document.getElementById('crf-val').style.textShadow = `0 0 12px ${glow}`;
    };

    function log(msg, cls = '') {
      console.log('Lens Log [' + cls + ']: ' + msg);
    }
    function setStatus(txt, state = '') { $('status-txt').textContent = txt; $('dot').className = 'dot ' + state; }

    function showToast(message, type = 'success') {
      const container = $('toast-container');
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.innerHTML = `<span>${type === 'success' ? '✓' : '✕'}</span> ${message}`;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 4200);
    }

    async function init() {
      $('loading-screen').classList.add('hidden');
      setStatus('Ready', 'ready');
      $('convert-btn').disabled = false;
      window.updateSlider($('crf').value);
      log('Desktop Engine loaded', 'success'); log('Drop videos to get started');
    }

    function addFiles(list) {
      for (const f of list) {
        if (!f.type.startsWith('video/') && !/\.(mkv|flv|wmv|avi|mov|webm|m4v|mp4)$/i.test(f.name)) continue;
        files.push({ file: f, id: ++ctr, name: f.name, size: f.size, status: 'pending', progress: 0, url: null });
        log('Added: ' + f.name);
      }
      renderFiles();
    }
    window.removeFile = async id => {
      const f = files.find(f => f.id === id);
      if (f && f.tempPath) await ipcRenderer.invoke('delete-file', f.tempPath);
      files = files.filter(f => f.id !== id);
      renderFiles();
    };
    window.clearAll = async () => {
      for (const f of files) {
        if (f.status !== 'converting' && f.tempPath) await ipcRenderer.invoke('delete-file', f.tempPath);
      }
      files = files.filter(f => f.status === 'converting');
      renderFiles();
    };

    const { formatBytes, generateOutputName, calculateETA } = require('./util');
    function fmt(b) { return formatBytes(b); }
    function outName(n, fmt) { return generateOutputName(n, fmt); }

    window.saveFile = async function(id) {
      console.log('Renderer: saveFile clicked for ID', id);
      const f = files.find(f => f.id === id);
      if (!f) { console.error('Renderer: File object not found for ID', id); return; }
      if (!f.tempPath) { console.error('Renderer: No tempPath for file', f); return; }
      
      const defaultName = outName(f.name, $('fmt').value);
      console.log('Renderer: invoking save-file IPC', { tempPath: f.tempPath, defaultName });
      
      try {
        const response = await ipcRenderer.invoke('save-file', { tempPath: f.tempPath, defaultName });
        if (response && response.success) {
          log('Saved: ' + response.path, 'success');
          showToast('File saved successfully!');
          f.tempPath = null; // Mark as moved
          renderFiles();
        } else if (response && response.error) {
          console.error('Renderer: Save failed', response.error);
          showToast('Save failed: ' + response.error, 'error');
        } else {
          console.log('Renderer: Save cancelled by user');
        }
      } catch (err) {
        console.error('Renderer: IPC invoke failure', err);
        alert('Save failed: ' + err.message);
      }
    };

    function renderFiles() {
      const list = $('file-list'), empty = $('empty-msg');
      $('q-count').textContent = files.length + ' file' + (files.length !== 1 ? 's' : '');
      if (!files.length) { list.innerHTML = ''; list.appendChild(empty); return; }
      if (list.contains(empty)) list.removeChild(empty);
      [...list.querySelectorAll('.file-card')].forEach(c => { if (!files.find(f => f.id == c.dataset.id)) c.remove(); });
      const isAudio = ['mp3', 'aac', 'wav'].includes($('fmt').value);
      files.forEach(f => {
        let card = list.querySelector(`.file-card[data-id="${f.id}"]`);
        if (!card) { card = document.createElement('div'); card.dataset.id = f.id; list.appendChild(card); }
        card.className = `file-card ${f.status}`;
        card.innerHTML = `
      <div class="file-thumb">${isAudio ? '🎵' : '🎬'}</div>
      <div class="file-info">
        <div class="file-name">${f.name}</div>
        <div class="file-meta">${fmt(f.size)} · ${f.name.split('.').pop().toUpperCase()}</div>
      </div>
      <div class="file-actions">
        <span class="file-status-badge ${f.status}">${f.status === 'pending' ? 'Pending' : f.status === 'converting' ? f.progress + '%' + (f.eta ? ' · ETA ' + f.eta : '') : f.status === 'done' ? '✓ Done' : '✗ Error'
          }</span>
        ${f.status === 'done' ? `<button class="dl-btn" onclick="window.saveFile(${f.id})">↓ Save As…</button>` : ''}
        ${f.status !== 'converting' ? `<button class="icon-btn" onclick="window.removeFile(${f.id})">×</button>` : ''}
      </div>
      ${f.status === 'converting' ? `
        <div class="prog-wrap">
          <div class="prog-fill" style="width:${f.progress}%; background: hsl(${(f.progress / 100) * 120}, 100%, 60%); box-shadow: 0 0 12px hsla(${(f.progress / 100) * 120}, 100%, 60%, 0.4);"></div>
        </div>` : ''}
    `;
      });
    }

    window.startConversion = async () => {
      const pending = files.filter(f => f.status === 'pending');
      if (!pending.length) return;
      $('convert-btn').disabled = true; setStatus('Converting…', 'working');
      const FMT = () => $('fmt').value, RES = () => $('res').value, FPS = () => $('fps').value,
        VC = () => $('vcodec').value, AC = () => $('acodec').value, CRF = () => $('crf').value;

      for (const f of pending) {
        f.status = 'converting'; f.progress = 0; renderFiles();
        try {
          const filePath = f.file.path;
          const ext = FMT();
          const basename = path.basename(filePath, path.extname(filePath));
          const outN = path.join(os.tmpdir(), `${basename}_converted_${f.id}.${ext}`);
          f.tempPath = outN;

          log('Processing: ' + f.name, 'accent');

          const args = ['-i', filePath];
          const audioOnly = ['mp3', 'aac', 'wav'].includes(FMT());

          if (FMT() === 'gif') {
            const vf = RES() ? `scale=${RES()}:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`
              : `scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
            args.push('-vf', vf, '-r', FPS() || '10');
          } else if (audioOnly) {
            args.push('-vn', '-c:a', AC() === 'copy' ? 'copy' : AC());
          } else {
            let actualVC = VC();
            if (!window.hasNvidiaGpu) {
              if (actualVC === 'h264_nvenc') { actualVC = 'libx264'; log('No NVIDIA GPU, fallback to CPU (H.264)', 'warn'); }
              if (actualVC === 'hevc_nvenc') { actualVC = 'libx265'; log('No NVIDIA GPU, fallback to CPU (HEVC)', 'warn'); }
            }

            if (actualVC === 'copy') args.push('-c:v', 'copy');
            else {
              args.push('-c:v', actualVC);

              if (['h264_nvenc', 'libx264'].includes(actualVC)) {
                args.push('-pix_fmt', 'yuv420p'); // Force 8-bit for H.264 to prevent crashes
              }

              if (['h264_nvenc', 'hevc_nvenc'].includes(actualVC)) {
                args.push('-preset', 'p4', '-rc', 'vbr', '-cq', CRF(), '-b:v', '0');
              } else {
                args.push('-crf', CRF());
                if (['libx264', 'libx265'].includes(actualVC)) args.push('-preset', 'fast');
              }
            }

            let vfArgs = [];
            if (RES()) {
              vfArgs.push(`scale=${RES()}`);
            } else if (['libx264', 'libx265', 'h264_nvenc', 'hevc_nvenc'].includes(actualVC)) {
              vfArgs.push(`scale=trunc(iw/2)*2:trunc(ih/2)*2`);
            }
            if (vfArgs.length > 0) args.push('-vf', vfArgs.join(','));

            if (FPS()) args.push('-r', FPS());
            if (AC() === 'none') args.push('-an'); else args.push('-c:a', AC() === 'copy' ? 'copy' : AC());
          }
          args.push('-y', outN);

          await new Promise((resolve, reject) => {
            let duration = 0;
            let startTime = Date.now();
            const execPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
            const proc = spawn(execPath, args);

            proc.stderr.on('data', data => {
              const msg = data.toString();
              const durMatch = msg.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
              if (durMatch) {
                duration = (parseFloat(durMatch[1]) * 3600 + parseFloat(durMatch[2]) * 60 + parseFloat(durMatch[3])) * 1000;
              }
              const timeMatch = msg.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
              if (timeMatch && duration > 0) {
                const time = (parseFloat(timeMatch[1]) * 3600 + parseFloat(timeMatch[2]) * 60 + parseFloat(timeMatch[3])) * 1000;
                const progressPct = time / duration;
                f.progress = Math.min(Math.round(progressPct * 100), 99);

                const elapsed = Date.now() - startTime;
                f.eta = calculateETA(progressPct, elapsed);
                renderFiles();
              }
              if (/Error/i.test(msg)) log(msg.split('\n')[0].slice(0, 90), 'error');
            });
            proc.on('close', code => {
              if (code === 0) resolve(); else reject(new Error(`FFmpeg exited with code ${code}`));
            });
            proc.on('error', err => reject(err));
          });

          f.status = 'done'; f.progress = 100;
          log('Done: ' + f.name + ' (click Save As to export)', 'success');
        } catch (e) { f.status = 'error'; log('Error: ' + e.message, 'error'); }
        renderFiles();
      }
      setStatus('Ready', 'ready'); $('convert-btn').disabled = false; log('All done ✓', 'success');
    };

    const dz = $('dz');
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); });
    $('fi').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

    $('fmt').addEventListener('change', () => {
      const v = $('fmt').value, au = ['mp3', 'aac', 'wav'].includes(v);
      ['res-row', 'fps-row', 'vcodec-row'].forEach(id => $(id).style.display = au ? 'none' : '');
      const vc = { mp4: 'h264_nvenc', mov: 'h264_nvenc', webm: 'libvpx-vp9', avi: 'mpeg4', mkv: 'hevc_nvenc' };
      const ac = { mp4: 'aac', mov: 'aac', webm: 'libopus', avi: 'libmp3lame', mkv: 'aac', mp3: 'libmp3lame', aac: 'aac', wav: 'copy' };
      if (vc[v]) $('vcodec').value = vc[v]; if (ac[v]) $('acodec').value = ac[v];
      renderFiles();
      if (window.syncGlassDropdowns) window.syncGlassDropdowns();
    });

    init();

    // Custom Glass Dropdowns
    function initGlassDropdowns() {
      document.querySelectorAll('.sel-wrap').forEach(wrap => {
        const select = wrap.querySelector('select');
        if (!select || wrap.querySelector('.custom-opts')) return;
        select.style.display = 'none';
        const arr = wrap.querySelector('.sel-arr');
        if (arr) arr.style.display = 'none';

        const trigger = document.createElement('div');
        trigger.className = 'custom-sel-trigger';
        trigger.innerHTML = `<span>${select.options[select.selectedIndex].text}</span><span style="opacity:0.5; font-size: 10px;">▼</span>`;
        wrap.appendChild(trigger);

        const opts = document.createElement('div');
        opts.className = 'custom-opts';

        Array.from(select.options).forEach((opt, idx) => {
          const item = document.createElement('div');
          item.className = 'custom-opt' + (idx === select.selectedIndex ? ' selected' : '');
          item.textContent = opt.text;
          item.onclick = (e) => {
            e.stopPropagation();
            select.selectedIndex = idx;
            select.dispatchEvent(new Event('change'));
            trigger.querySelector('span').textContent = opt.text;
            opts.querySelectorAll('.custom-opt').forEach(o => o.classList.remove('selected'));
            item.classList.add('selected');
            opts.classList.remove('open');
            wrap.style.zIndex = '';
          };
          opts.appendChild(item);
        });
        wrap.appendChild(opts);

        trigger.onclick = (e) => {
          e.stopPropagation();
          document.querySelectorAll('.sel-wrap').forEach(w => w.style.zIndex = '');
          document.querySelectorAll('.custom-opts').forEach(o => { if (o !== opts) o.classList.remove('open'); });
          opts.classList.toggle('open');
          if (opts.classList.contains('open')) wrap.style.zIndex = '100';
        };
      });
      document.addEventListener('click', () => {
        document.querySelectorAll('.custom-opts').forEach(o => o.classList.remove('open'));
        document.querySelectorAll('.sel-wrap').forEach(w => w.style.zIndex = '');
      });
    }

    window.syncGlassDropdowns = function () {
      document.querySelectorAll('.sel-wrap').forEach(wrap => {
        const select = wrap.querySelector('select');
        const triggerSpan = wrap.querySelector('.custom-sel-trigger span');
        const opts = wrap.querySelector('.custom-opts');
        if (!select || !triggerSpan || !opts) return;
        triggerSpan.textContent = select.options[select.selectedIndex].text;
        opts.querySelectorAll('.custom-opt').forEach((o, i) => {
          if (i === select.selectedIndex) o.classList.add('selected');
          else o.classList.remove('selected');
        });
      });
    };

    setTimeout(initGlassDropdowns, 100);

    let gpuInterval = null;
    function startGPUMonitor() {
      const gpuChip = document.getElementById('gpu-chip');
      const gpuPct = document.getElementById('gpu-pct');
      const gpuLbl = document.getElementById('gpu-lbl');
      const canvas = document.getElementById('gpu-graph');
      const ctx = canvas ? canvas.getContext('2d') : null;
      let history = new Array(30).fill(0);

      gpuInterval = setInterval(() => {
        exec('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', (err, stdout) => {
          if (!err && stdout) {
            const usage = parseInt(stdout.trim());
            if (!isNaN(usage)) {
              if (gpuChip.style.opacity === '0' || gpuChip.style.opacity === '') gpuChip.style.opacity = '1';
              gpuPct.innerHTML = usage + '<span style="color:var(--text-faint)">%</span>';

              const colorVar = usage > 80 ? 'var(--error)' : usage > 50 ? 'var(--warn)' : 'var(--success)';
              const hexColor = usage > 80 ? '#ff6e82' : usage > 50 ? '#ffb450' : '#50c88c';
              gpuLbl.style.color = colorVar;

              if (ctx) {
                history.push(usage);
                history.shift();

                const rect = canvas.getBoundingClientRect();
                if (rect.width > 0 && (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height))) {
                  canvas.width = Math.floor(rect.width);
                  canvas.height = Math.floor(rect.height);
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);

                // Add Fill
                ctx.beginPath();
                ctx.moveTo(0, canvas.height);
                ctx.lineTo(0, canvas.height - (history[0] / 100) * canvas.height);
                for (let i = 1; i < history.length; i++) {
                  ctx.lineTo((i / (history.length - 1)) * canvas.width, canvas.height - (history[i] / 100) * canvas.height);
                }
                ctx.lineTo(canvas.width, canvas.height);
                ctx.fillStyle = hexColor + '50';
                ctx.fill();

                // Add Stroke Outline
                ctx.beginPath();
                ctx.moveTo(0, canvas.height - (history[0] / 100) * canvas.height);
                for (let i = 1; i < history.length; i++) {
                  ctx.lineTo((i / (history.length - 1)) * canvas.width, canvas.height - (history[i] / 100) * canvas.height);
                }
                ctx.strokeStyle = hexColor;
                ctx.lineWidth = 2.0;
                ctx.stroke();

                canvas.style.filter = `drop-shadow(0 0 8px ${hexColor}80)`;
              }
            }
          }
        });
      }, 1500);
    }

    // Start monitor if NVIDIA SMI is successfully reachable
    window.hasNvidiaGpu = false;
    exec('nvidia-smi', (err) => {
      if (!err) {
        window.hasNvidiaGpu = true;
        startGPUMonitor();
      }
    });