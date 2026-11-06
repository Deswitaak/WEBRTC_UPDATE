const socket = io();

const config = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

const peerConnections = {};

let activeStream = null;
let sourceElement = null;
let objectURL = null;
let isBroadcasting = false;
let roomId = null;
let recognition = null;
let recognitionActive = false;
let manuallyStopped = false;

const viewerIds = new Set();
const viewerNames = {};       // viewerId -> nama tampilan

// State kamera viewer -> broadcaster
const viewerPeers = {};        // dipakai broadcaster: viewerId -> RTCPeerConnection
const pendingViewerIce = {};   // antrean ICE di sisi broadcaster
let viewerRoomId = null;
let viewerBroadcasterId = null;
let viewerPc = null;
let viewerStream = null;
let viewerPendingIce = [];
let viewerMediaReady = false;

// ========================================
// LOGIKA BROADCASTER
// ========================================

export async function startBroadcast() {

    const localVideo = document.getElementById('localVideo');

    const tokenDisplay = document.getElementById('token');

    const cameraStatus = document.getElementById('cameraStatus');

    const broadcastStatus = document.getElementById('broadcastStatus');

    const mediaStatus = document.getElementById('mediaSourceStatus');

    const fileInput = document.getElementById('mediaFileInput');

    const chooseFileBtn = document.getElementById('chooseFileBtn');

    const cameraBtn = document.getElementById('cameraSourceBtn');

    const startBtn = document.getElementById('startBroadcastBtn');

    const stopBtn = document.getElementById('stopBroadcastBtn');

    const clearBtn = document.getElementById('clearMediaBtn');

    const selectedBox = document.getElementById('selectedMediaBox');

    const selectedName = document.getElementById('selectedFileName');

    const selectedType = document.getElementById('selectedFileType');

    const liveBadge = document.getElementById('liveBadge');

    const audioSource = document.getElementById('audioSource');

    // Membuat room token
    roomId = Math.random().toString(36).substring(2, 10);

    tokenDisplay.textContent = roomId;

    socket.emit('join-room', roomId);

    // Salin token
    document.getElementById('copyTokenBtn')?.addEventListener(
        'click',
        async () => {

            try {
                await navigator.clipboard.writeText(roomId);

                const button = document.getElementById('copyTokenBtn');

                button.textContent = '✓ Token Tersalin';

                setTimeout(() => {
                    button.textContent = '▢ Salin Token';
                }, 1800);

            } catch (error) {
                alert('Token room: ' + roomId);
            }
        }
    );

    // ========================================
    // FUNGSI STATUS
    // ========================================

    function setStatus(element, message, success = false) {

        if (!element) return;

        element.textContent = message;

        element.className = success
            ? 'status success'
            : 'status';
    }

    function updateControls() {

        startBtn.disabled = !activeStream || isBroadcasting;

        stopBtn.disabled = !isBroadcasting;

        chooseFileBtn.disabled = isBroadcasting;

        cameraBtn.disabled = isBroadcasting;

        clearBtn.disabled = isBroadcasting;
    }

    // ========================================
    // MEMBERSIHKAN SUMBER MEDIA
    // ========================================

    function cleanupSource() {

        if (activeStream) {

            activeStream.getTracks().forEach(track => {
                track.stop();
            });

            activeStream = null;
        }

        if (sourceElement) {

            sourceElement.pause();

            sourceElement.removeAttribute('src');

            sourceElement.srcObject = null;

            sourceElement.load();

            sourceElement = null;
        }

        if (audioSource) {
            audioSource.pause();
            audioSource.removeAttribute('src');
            audioSource.load();
        }

        localVideo.pause();

        localVideo.srcObject = null;

        localVideo.removeAttribute('src');

        localVideo.load();

        if (objectURL) {
            URL.revokeObjectURL(objectURL);
            objectURL = null;
        }

        localVideo.hidden = false;
    }

    // ========================================
    // MEMILIH SUMBER MEDIA
    // ========================================

    function setSelectedSource(stream, name, type) {

        activeStream = stream;

        selectedBox.hidden = false;

        selectedName.textContent = name;

        selectedType.textContent = type;

        setStatus(
            mediaStatus,
            'Sumber media berhasil dipilih.',
            true
        );

        setStatus(
            cameraStatus,
            type,
            true
        );

        setStatus(
            broadcastStatus,
            'Media siap. Klik Start Broadcasting.'
        );

        updateControls();
    }

    // ========================================
    // UPLOAD FILE MEDIA
    // ========================================

    chooseFileBtn.addEventListener('click', () => {

        if (isBroadcasting) return;

        fileInput.click();

    });

    fileInput.addEventListener('change', async (event) => {

        const file = event.target.files[0];

        if (!file) return;

        if (!file.type.startsWith('video/') &&
            !file.type.startsWith('image/') &&
            !file.type.startsWith('audio/')) {

            alert('Format file tidak didukung.');

            fileInput.value = '';

            return;
        }

        cleanupSource();

        selectedBox.hidden = true;

        objectURL = URL.createObjectURL(file);

        try {

            // ====================================
            // VIDEO
            // ====================================

            if (file.type.startsWith('video/')) {

                const video = document.createElement('video');

                sourceElement = video;

                video.src = objectURL;

                video.autoplay = false;

                video.loop = true;

                video.playsInline = true;

                video.muted = false;

                video.controls = true;

                await new Promise((resolve, reject) => {

                    video.onloadedmetadata = resolve;

                    video.onerror = () => reject(
                        new Error('Video tidak dapat dibaca.')
                    );

                });

                await video.play();

                const capture = video.captureStream ||
                                video.mozCaptureStream;

                if (!capture) {
                    throw new Error(
                        'Browser tidak mendukung captureStream video.'
                    );
                }

                const stream = capture.call(video);

                activeStream = stream;

                localVideo.srcObject = stream;

                await localVideo.play();

                setSelectedSource(
                    stream,
                    file.name,
                    'Video • ' + file.type
                );

            }

            // ====================================
            // GAMBAR
            // ====================================

            else if (file.type.startsWith('image/')) {

                const image = new Image();

                image.src = objectURL;

                await new Promise((resolve, reject) => {

                    image.onload = resolve;

                    image.onerror = () => reject(
                        new Error('Gambar tidak dapat dibaca.')
                    );

                });

                const canvas = document.createElement('canvas');

                canvas.width = image.naturalWidth;

                canvas.height = image.naturalHeight;

                const context = canvas.getContext('2d');

                context.drawImage(
                    image,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

                // Gambar dijadikan video stream melalui Canvas
                const stream = canvas.captureStream(15);

                activeStream = stream;

                localVideo.srcObject = stream;

                await localVideo.play();

                setSelectedSource(
                    stream,
                    file.name,
                    'Gambar • ' + file.type
                );

            }

            // ====================================
            // AUDIO
            // ====================================

            else if (file.type.startsWith('audio/')) {

                audioSource.src = objectURL;

                audioSource.loop = true;

                await new Promise((resolve, reject) => {

                    audioSource.onloadedmetadata = resolve;

                    audioSource.onerror = () => reject(
                        new Error('Audio tidak dapat dibaca.')
                    );

                });

                const capture = audioSource.captureStream ||
                                audioSource.mozCaptureStream;

                if (!capture) {
                    throw new Error(
                        'Browser tidak mendukung captureStream audio.'
                    );
                }

                await audioSource.play();

                const stream = capture.call(audioSource);

                activeStream = stream;

                localVideo.srcObject = stream;

                setSelectedSource(
                    stream,
                    file.name,
                    'Audio • ' + file.type
                );

            }

        } catch (error) {

            console.error('Media error:', error);

            cleanupSource();

            selectedBox.hidden = true;

            setStatus(
                mediaStatus,
                'Gagal membuka media: ' + error.message
            );

            alert(error.message);

        }

    });

    // ========================================
    // MENGAKTIFKAN KAMERA
    // ========================================

    cameraBtn.addEventListener('click', async () => {

        if (isBroadcasting) return;

        try {

            cleanupSource();

            const stream =
                await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: true
                });

            localVideo.srcObject = stream;

            await localVideo.play();

            setSelectedSource(
                stream,
                'Live Camera',
                'Kamera dan Mikrofon'
            );

            selectedBox.hidden = true;

        } catch (error) {

            console.error('Camera error:', error);

            setStatus(
                cameraStatus,
                'Gagal mengakses kamera.'
            );

            alert(
                'Tidak dapat mengakses kamera atau mikrofon. ' +
                'Periksa izin browser.'
            );

        }

    });

    // ========================================
    // HAPUS MEDIA
    // ========================================

    clearBtn.addEventListener('click', () => {

        if (isBroadcasting) return;

        cleanupSource();

        fileInput.value = '';

        selectedBox.hidden = true;

        setStatus(cameraStatus, 'Menunggu sumber media');

        setStatus(
            mediaStatus,
            'Belum ada sumber media dipilih.'
        );

        setStatus(
            broadcastStatus,
            'Pilih sumber media terlebih dahulu.'
        );

        updateControls();

    });

    // ========================================
    // MEMBUAT PEER CONNECTION
    // ========================================

    async function createPeerConnection(viewerId) {

        if (!activeStream || !isBroadcasting) return;

        if (peerConnections[viewerId]) return;

        console.log('Menghubungkan Viewer:', viewerId);

        const pc = new RTCPeerConnection(config);

        peerConnections[viewerId] = pc;

        // Mengirim semua track media aktif
        activeStream.getTracks().forEach(track => {

            pc.addTrack(track, activeStream);

        });

        // ICE Candidate
        pc.onicecandidate = event => {

            if (event.candidate) {

                socket.emit('ice-candidate', {
                    roomId,
                     target: viewerId,
                    candidate: event.candidate
                });

                

            }

        };

        pc.onconnectionstatechange = () => {

            console.log(
                'Connection state:',
                pc.connectionState
            );

        };

        // Membuat Offer
        const offer = await pc.createOffer();

        await pc.setLocalDescription(offer);

        socket.emit('offer', {
            target: viewerId,
            sdp: offer
        });

    }

    // ========================================
    // START BROADCASTING
    // ========================================

    startBtn.addEventListener('click', async () => {

        if (!activeStream || isBroadcasting) return;

        isBroadcasting = true;

        liveBadge.textContent = '🔴 LIVE';

        updateControls();

        setStatus(
            broadcastStatus,
            'Siaran sedang berjalan.',
            true
        );

        // Hubungkan viewer yang sudah bergabung
        for (const viewerId of viewerIds) {

            try {
                await createPeerConnection(viewerId);

            } catch (error) {

                console.error('Gagal membuat koneksi:', error);

            }

        }

    });

    // ========================================
    // STOP BROADCASTING
    // ========================================

    stopBtn.addEventListener('click', () => {

        isBroadcasting = false;

        // Tutup seluruh peer connection
        Object.values(peerConnections).forEach(pc => {
            pc.close();
        });

        Object.keys(peerConnections).forEach(id => {
            delete peerConnections[id];
        });

        // Hentikan subtitle
        if (recognition) {

            manuallyStopped = true;

            try {
                recognition.stop();
            } catch (error) {
                console.warn(error);
            }

        }

        cleanupSource();

        fileInput.value = '';

        selectedBox.hidden = true;

        liveBadge.textContent = '● PREVIEW';

        setStatus(
            cameraStatus,
            'Sumber media dihentikan.'
        );

        setStatus(
            broadcastStatus,
            'Siaran telah dihentikan.'
        );

        setStatus(
            mediaStatus,
            'Pilih sumber media untuk memulai kembali.'
        );

        updateControls();

    });

    // ========================================
    // VIEWER BERGABUNG
    // ========================================

    socket.on('viewer-joined', async ({ viewerId }) => {

        console.log('Viewer bergabung:', viewerId);

        viewerIds.add(viewerId);

        if (isBroadcasting && activeStream) {

            try {

                await createPeerConnection(viewerId);

            } catch (error) {

                console.error(error);

            }

        }

    });

    // ========================================
    // MENERIMA ANSWER
    // ========================================

    socket.on('answer', async ({ sdp, viewerId }) => {

        const pc = peerConnections[viewerId];

        if (pc) {

            try {

                await pc.setRemoteDescription(
                    new RTCSessionDescription(sdp)
                );

            } catch (error) {

                console.error('Answer error:', error);

            }

        }

    });

    // ========================================
    // MENERIMA ICE CANDIDATE
    // ========================================

    socket.on('ice-candidate', async ({ candidate, senderId }) => {

        const pc = peerConnections[senderId];

        if (pc && candidate) {

            try {

                await pc.addIceCandidate(
                    new RTCIceCandidate(candidate)
                );

            } catch (error) {

                console.error('ICE error:', error);

            }

        }

    });

        // ========================================
    // KAMERA VIEWER (diterima broadcaster)
    // ========================================

    const viewerVideos = document.getElementById('viewerVideos');
    const viewerVideosEmpty = document.getElementById('viewerVideosEmpty');

    function getViewerTile(viewerId) {
        let tile = document.getElementById('tile-' + viewerId);
        if (tile) return tile;

        tile = document.createElement('div');
        tile.id = 'tile-' + viewerId;
        tile.className = 'viewer-tile';
        const tileVideo = document.createElement('video');
        tileVideo.autoplay = true;
        tileVideo.playsInline = true;

        const tileLabel = document.createElement('span');
        tileLabel.className = 'viewer-tile-label';
        // textContent (bukan innerHTML) agar nama aman dari injeksi HTML
        tileLabel.textContent =
            viewerNames[viewerId] || ('Viewer ' + viewerId.slice(0, 5));

        tile.append(tileVideo, tileLabel);

        viewerVideos.appendChild(tile);
        viewerVideosEmpty.hidden = true;
        return tile;
    }

    function removeViewerTile(viewerId) {
        viewerPeers[viewerId]?.close();
        delete viewerPeers[viewerId];
        delete pendingViewerIce[viewerId];
        delete viewerNames[viewerId];

        document.getElementById('tile-' + viewerId)?.remove();

        if (!viewerVideos.children.length) {
            viewerVideosEmpty.hidden = false;
        }
    }

    socket.on('viewer-offer', async ({ sdp, viewerId, name }) => {

        if (name) {
            viewerNames[viewerId] = name;

            const label = document.getElementById('tile-' + viewerId)
                ?.querySelector('.viewer-tile-label');

            if (label) label.textContent = name;
        }

        let pc = viewerPeers[viewerId];

        if (!pc) {
            pc = new RTCPeerConnection(config);
            viewerPeers[viewerId] = pc;
            pendingViewerIce[viewerId] = [];

            pc.ontrack = event => {
                const video = getViewerTile(viewerId).querySelector('video');

                if (video.srcObject !== event.streams[0]) {
                    video.srcObject = event.streams[0];
                }

                video.play().catch(() => {});
            };

            pc.onicecandidate = event => {
                if (event.candidate) {
                    socket.emit('viewer-ice', {
                        target: viewerId,
                        candidate: event.candidate
                    });
                }
            };
        }

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));

            for (const c of pendingViewerIce[viewerId] || []) {
                await pc.addIceCandidate(new RTCIceCandidate(c));
            }
            pendingViewerIce[viewerId] = [];

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit('viewer-answer', {
                target: viewerId,
                sdp: answer
            });
        } catch (error) {
            console.error('viewer-offer error:', error);
        }
    });

    socket.on('viewer-ice', async ({ candidate, senderId }) => {
        const pc = viewerPeers[senderId];
        if (!pc || !candidate) return;

        if (!pc.remoteDescription) {
            (pendingViewerIce[senderId] ||= []).push(candidate);
            return;
        }

        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error('viewer-ice error:', error);
        }
    });

    socket.on('viewer-left', ({ viewerId }) => removeViewerTile(viewerId));

    // ========================================
    // LIVE AUTO SUBTITLE
    // ========================================

    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    const captionBtn =
        document.getElementById('startCaptionBtn');

    const speechStatus =
        document.getElementById('speechStatus');

    if (!SpeechRecognition) {

        setStatus(
            speechStatus,
            'Browser tidak mendukung Speech Recognition.'
        );

    } else {

        recognition = new SpeechRecognition();

        recognition.lang = 'id-ID';

        recognition.continuous = true;

        recognition.interimResults = true;

        captionBtn.addEventListener('click', () => {

            if (recognitionActive) return;

            manuallyStopped = false;

            try {

                recognition.start();

            } catch (error) {

                console.error(error);

            }

        });

        recognition.onstart = () => {

            recognitionActive = true;

            setStatus(
                speechStatus,
                'Mendengarkan suara...',
                true
            );

            captionBtn.textContent = '🎙️ Subtitle Aktif';

        };

        recognition.onresult = event => {

            for (
                let i = event.resultIndex;
                i < event.results.length;
                i++
            ) {

                const result = event.results[i];

                const transcript = result[0].transcript.trim();

                if (!transcript) continue;

                socket.emit('caption', {
                    roomId,
                    text: transcript,
                    isFinal: result.isFinal
                });

            }

        };

        recognition.onerror = event => {

            setStatus(
                speechStatus,
                'Subtitle error: ' + event.error
            );

        };

        recognition.onend = () => {

            recognitionActive = false;

            if (manuallyStopped) return;

            setTimeout(() => {

                if (!manuallyStopped) {

                    try {
                        recognition.start();
                    } catch (error) {
                        console.warn(error);
                    }

                }

            }, 1000);

        };

    }

    // Status awal
    setStatus(
        mediaStatus,
        'Belum ada sumber media dipilih.'
    );

    updateControls();

}

// ========================================
// MESH ANTAR-VIEWER (viewer lain tampil di halaman viewer)
// Memakai "perfect negotiation": kamera/mikrofon bisa dinyalakan
// kapan saja dan dua sisi boleh saling kirim offer tanpa bentrok.
// ========================================

const meshPeers = {}; // peerId -> { pc, stream, pendingIce, senders, tile, video, badge, name, camOn, ... }

function localTrackOfKind(kind) {
    return viewerStream?.getTracks().find(
        t => t.kind === kind && t.readyState === 'live'
    ) || null;
}

function hasLocalTracks() {
    return !!(localTrackOfKind('audio') || localTrackOfKind('video'));
}

function sendMediaState(target) {
    if (!viewerRoomId) return;
    socket.emit('peer-media', {
        roomId: viewerRoomId,
        target,
        video: !!localTrackOfKind('video'),
        audio: !!localTrackOfKind('audio')
    });
}

function playPeerVideo(video) {
    video.play().catch(() => {
        // Autoplay dengan suara diblokir -> mainkan tanpa suara
        video.muted = true;
        video.play().catch(() => {});
    });
}

// Pasang / ganti / lepas track lokal pada satu peer
function syncLocalTracks(peer) {
    const pc = peer.pc;
    if (!pc || pc.signalingState === 'closed') return;

    ['audio', 'video'].forEach(kind => {
        const track = localTrackOfKind(kind);
        const sender = peer.senders[kind];

        if (sender) {
            if (sender.track !== track) {
                sender.replaceTrack(track).catch(() => {});
            }
        } else if (track) {
            // addTrack memicu onnegotiationneeded -> offer otomatis
            peer.senders[kind] = pc.addTrack(track, viewerStream);
        }
    });
}

function applyLocalTracksToAll() {
    const hasTrack = hasLocalTracks();

    Object.entries(meshPeers).forEach(([id, peer]) => {
        if (!peer.pc && hasTrack) createMeshPc(id);
        syncLocalTracks(peer);
    });

    sendMediaState();
}

function ensurePeerTile(peerId, name) {
    let peer = meshPeers[peerId];
    if (!peer) {
        peer = meshPeers[peerId] = {
            pc: null,
            stream: new MediaStream(),
            pendingIce: [],
            senders: {},
            makingOffer: false,
            ignoreOffer: false,
            tile: null,
            video: null,
            badge: null,
            name: 'Viewer',
            camOn: false
        };
    }
    if (name) peer.name = name;

    const grid = document.getElementById('meetGrid');
    if (!peer.tile && grid) {
        const tile = document.createElement('div');
        tile.className = 'meet-tile';

        const badge = document.createElement('span');
        badge.className = 'video-badge';

        const video = document.createElement('video');
        video.autoplay = true;
        video.playsInline = true;

        tile.append(badge, video);
        grid.appendChild(tile);

        peer.tile = tile;
        peer.badge = badge;
        peer.video = video;
    }
    if (peer.badge) {
        peer.badge.textContent =
            '👤 ' + peer.name + (peer.camOn ? '' : ' (kamera mati)');
    }
    if (peer.video) {
        peer.video.style.visibility = peer.camOn ? 'visible' : 'hidden';
    }
    return peer;
}

function removePeer(peerId) {
    const peer = meshPeers[peerId];
    if (!peer) return;
    if (peer.pc) {
        peer.pc.onnegotiationneeded = null;
        peer.pc.close();
    }
    peer.tile?.remove();
    delete meshPeers[peerId];
}

function createMeshPc(peerId, attachTracks = true) {
    const peer = ensurePeerTile(peerId);
    const pc = new RTCPeerConnection(config);

    peer.pc = pc;
    peer.senders = {};
    peer.makingOffer = false;
    peer.ignoreOffer = false;

    pc.onnegotiationneeded = async () => {
        try {
            peer.makingOffer = true;
            await pc.setLocalDescription();
            socket.emit('peer-offer', {
                target: peerId,
                sdp: pc.localDescription
            });
        } catch (error) {
            console.error('[mesh] negotiation error:', error);
        } finally {
            peer.makingOffer = false;
        }
    };

    pc.ontrack = ({ track, streams }) => {
        console.log('[mesh] track dari', peerId, track.kind);

        let stream = streams[0];
        if (!stream) {
            peer.stream.addTrack(track);
            stream = peer.stream;
        }

        if (peer.video && peer.video.srcObject !== stream) {
            peer.video.srcObject = stream;
        }
        if (peer.video) playPeerVideo(peer.video);

        track.onunmute = () => {
            if (peer.video) playPeerVideo(peer.video);
        };
    };

    pc.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('peer-ice', {
                target: peerId,
                candidate: event.candidate
            });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log('[mesh]', peerId, 'connection:', pc.connectionState);
        if (pc.connectionState === 'failed') {
            try { pc.restartIce(); } catch (e) {}
        }
    };

    if (attachTracks) syncLocalTracks(peer);

    return pc;
}

async function flushPeerIce(peer) {
    const list = peer.pendingIce;
    peer.pendingIce = [];
    for (const c of list) {
        try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (e) {
            if (!peer.ignoreOffer) console.warn('[mesh] ICE error:', e);
        }
    }
}

function setupMesh() {
    Object.keys(meshPeers).forEach(removePeer);

    ['room-peers', 'viewer-joined', 'peer-left',
     'peer-offer', 'peer-answer', 'peer-ice', 'peer-media']
        .forEach(ev => socket.off(ev));

    function introduce(peerId, name) {
        const peer = ensurePeerTile(peerId, name);
        sendMediaState(peerId);
        // Kalau kamera/mikrofon sudah aktif, langsung kirim ke peer ini
        if (hasLocalTracks() && !peer.pc) createMeshPc(peerId);
    }

    // Saya viewer baru: siapkan tile untuk semua viewer yang sudah ada
    socket.on('room-peers', ({ peers }) => {
        console.log('[mesh] room-peers', peers);
        peers.forEach(p => introduce(p.viewerId, p.name));
    });

    // Ada viewer baru bergabung
    socket.on('viewer-joined', ({ viewerId, name }) => {
        console.log('[mesh] viewer-joined', viewerId, name);
        introduce(viewerId, name);
    });

    socket.on('peer-left', ({ viewerId }) => removePeer(viewerId));

    socket.on('peer-offer', async ({ sdp, senderId }) => {
        console.log('[mesh] peer-offer dari', senderId);

        const peer = ensurePeerTile(senderId);
        const pc = peer.pc || createMeshPc(senderId, false);

        // Perfect negotiation: ID socket lebih kecil = "polite"
        const polite = socket.id < senderId;
        const collision =
            peer.makingOffer || pc.signalingState !== 'stable';

        peer.ignoreOffer = !polite && collision;
        if (peer.ignoreOffer) return;

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));
            await flushPeerIce(peer);

            // Sertakan kamera/mikrofon kita di jawaban
            syncLocalTracks(peer);

            await pc.setLocalDescription();
            socket.emit('peer-answer', {
                target: senderId,
                sdp: pc.localDescription
            });
        } catch (error) {
            console.error('[mesh] peer-offer error:', error);
        }
    });

    socket.on('peer-answer', async ({ sdp, senderId }) => {
        const peer = meshPeers[senderId];
        if (!peer?.pc) return;
        if (peer.pc.signalingState !== 'have-local-offer') return;

        try {
            await peer.pc.setRemoteDescription(new RTCSessionDescription(sdp));
            await flushPeerIce(peer);
        } catch (error) {
            console.error('[mesh] peer-answer error:', error);
        }
    });

    socket.on('peer-ice', async ({ candidate, senderId }) => {
        const peer = meshPeers[senderId];
        if (!peer || !candidate) return;

        if (!peer.pc || !peer.pc.remoteDescription) {
            peer.pendingIce.push(candidate);
            return;
        }

        try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            if (!peer.ignoreOffer) console.warn('[mesh] peer-ice error:', error);
        }
    });

    // Tampilkan/sembunyikan video peer sesuai status kameranya
    socket.on('peer-media', ({ senderId, video }) => {
        const peer = ensurePeerTile(senderId);
        peer.camOn = !!video;
        ensurePeerTile(senderId); // perbarui label & visibilitas
    });
}

// ========================================
// KAMERA & MIKROFON VIEWER (dikirim ke broadcaster)
// ========================================

export function initViewerMedia() {

    if (viewerMediaReady) return;
    viewerMediaReady = true;

    const camBtn = document.getElementById('viewerCameraBtn');
    const micBtn = document.getElementById('viewerMicBtn');
    const stopBtn = document.getElementById('viewerStopBtn');
    const localVideo = document.getElementById('viewerLocalVideo');
    const statusEl = document.getElementById('viewerMediaStatus');

    function setMsg(text, ok = false) {
        statusEl.textContent = text;
        statusEl.className = ok ? 'status success' : 'status';
    }

    function refreshStatus() {
        const hasVideo = viewerStream?.getVideoTracks().length > 0;
        const hasAudio = viewerStream?.getAudioTracks().length > 0;

        if (!hasVideo && !hasAudio) {
            setMsg('Kamera dan mikrofon belum aktif.');
            return;
        }

        setMsg(
            'Aktif: ' +
            [hasVideo && 'kamera', hasAudio && 'mikrofon']
                .filter(Boolean).join(' + ') +
            ' (dikirim ke broadcaster)',
            true
        );
    }

    function ensurePc() {
        if (viewerPc) return viewerPc;

        viewerPc = new RTCPeerConnection(config);
        viewerPendingIce = [];

        viewerPc.onicecandidate = event => {
            if (event.candidate && viewerBroadcasterId) {
                socket.emit('viewer-ice', {
                    target: viewerBroadcasterId,
                    candidate: event.candidate
                });
            }
        };

        // Dipanggil otomatis setiap kali track baru ditambahkan
        viewerPc.onnegotiationneeded = async () => {
            try {
                const offer = await viewerPc.createOffer();
                await viewerPc.setLocalDescription(offer);

                socket.emit('viewer-offer', {
                    roomId: viewerRoomId,
                    sdp: viewerPc.localDescription
                });
            } catch (error) {
                console.error('Negotiation error:', error);
            }
        };

        return viewerPc;
    }

    async function enable(kind) {

        if (!viewerRoomId) {
            setMsg('Join room dulu sebelum mengaktifkan kamera/mikrofon.');
            return;
        }

        if (viewerStream?.getTracks().some(t => t.kind === kind)) return;

        try {
            const media = await navigator.mediaDevices.getUserMedia(
                kind === 'video' ? { video: true } : { audio: true }
            );

            const track = media.getTracks()[0];

            if (!viewerStream) viewerStream = new MediaStream();
            viewerStream.addTrack(track);

            localVideo.srcObject = viewerStream;
            localVideo.play().catch(() => {});

            ensurePc().addTrack(track, viewerStream);
            applyLocalTracksToAll();

            refreshStatus();
        } catch (error) {
            console.error('Viewer media error:', error);
            setMsg('Gagal mengakses perangkat. Periksa izin browser.');
        }
    }

    camBtn.addEventListener('click', () => enable('video'));
    micBtn.addEventListener('click', () => enable('audio'));

    stopBtn.addEventListener('click', () => {
        viewerStream?.getTracks().forEach(t => t.stop());
        viewerStream = null;
        applyLocalTracksToAll();
        localVideo.srcObject = null;

        if (viewerPc) {
            viewerPc.close();
            viewerPc = null;
        }

        viewerPendingIce = [];

        if (viewerRoomId) {
            socket.emit('viewer-stopped', { roomId: viewerRoomId });
        }

        refreshStatus();
    });
}

// ========================================
// LOGIKA VIEWER
// ========================================

export async function startView(roomId, displayName = '') {

    let peerConnection;

    const remoteVideo = document.getElementById('remoteVideo');

    const subtitleText = document.getElementById('subtitleText');

    const subtitlePanel = document.getElementById('subtitlePanel');

    const joinStatus = document.getElementById('joinStatus');

    const connectionStatus =
        document.getElementById('connectionStatus');

    socket.off('caption');

    socket.on('caption', ({ text, isFinal }) => {

        if (!subtitleText || !text) return;

        subtitleText.textContent = text;

        subtitlePanel?.classList.add('is-listening');

    });

    if (joinStatus) {
        joinStatus.textContent =
            'Token diterima. Mencari broadcaster...';
    }

    if (connectionStatus) {
        connectionStatus.textContent =
            'Menunggu koneksi WebRTC...';
    }

    socket.off('offer');
    socket.off('ice-candidate');

    viewerRoomId = roomId;
    viewerBroadcasterId = null;

    socket.off('broadcaster-info');
    socket.off('viewer-answer');
    socket.off('viewer-ice');

    socket.on('broadcaster-info', ({ broadcasterId }) => {
        viewerBroadcasterId = broadcasterId;
    });

    socket.on('viewer-answer', async ({ sdp }) => {
        if (!viewerPc) return;

        try {
            await viewerPc.setRemoteDescription(new RTCSessionDescription(sdp));

            for (const c of viewerPendingIce) {
                await viewerPc.addIceCandidate(new RTCIceCandidate(c));
            }
            viewerPendingIce = [];
        } catch (error) {
            console.error('viewer-answer error:', error);
        }
    });

    socket.on('viewer-ice', async ({ candidate }) => {
        if (!viewerPc || !candidate) return;

        if (!viewerPc.remoteDescription) {
            viewerPendingIce.push(candidate);
            return;
        }

        try {
            await viewerPc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error('viewer-ice error:', error);
        }
    });

    setupMesh();
    socket.emit('join-as-viewer', { roomId, name: displayName });

    // Menerima Offer dari broadcaster
    let pendingIce = [];

    socket.on('offer', async ({ sdp, broadcasterId }) => {

        console.log('Menerima offer dari broadcaster.');

        // Tutup koneksi lama (kalau ada) supaya tidak menggantung
        if (peerConnection) {
            peerConnection.ontrack = null;
            peerConnection.close();
        }
        pendingIce = [];

        const pc = peerConnection = new RTCPeerConnection(config);

        pc.ontrack = event => {

            const stream = event.streams && event.streams[0];
            if (!stream) return;

            // ontrack jalan per track (audio + video); set srcObject sekali saja
            if (remoteVideo.srcObject !== stream) {
                remoteVideo.srcObject = stream;
            }

            remoteVideo.play().catch(error => {
                console.warn('Autoplay:', error);
            });

            if (joinStatus) {
                joinStatus.textContent = 'Berhasil bergabung ke room!';
                joinStatus.className = 'status success';
            }

            if (connectionStatus) {
                connectionStatus.textContent =
                    'Terhubung — media sedang diterima.';
                connectionStatus.className = 'status success';
            }
        };

        pc.onicecandidate = event => {
            if (event.candidate) {
                socket.emit('ice-candidate', {
                    roomId,
                    target: broadcasterId,
                    candidate: event.candidate
                });
            }
        };

        try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp));

            for (const c of pendingIce) {
                await pc.addIceCandidate(new RTCIceCandidate(c));
            }
            pendingIce = [];

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit('answer', {
                target: broadcasterId,
                sdp: answer
            });
        } catch (error) {
            console.error('Offer error:', error);
        }
    });

    // Menerima ICE Candidate dari broadcaster
    socket.on('ice-candidate', async ({ candidate }) => {

        if (!peerConnection || !candidate) return;

        // Tahan dulu kalau remote description belum terpasang
        if (!peerConnection.remoteDescription) {
            pendingIce.push(candidate);
            return;
        }

        try {
            await peerConnection.addIceCandidate(
                new RTCIceCandidate(candidate)
            );
        } catch (error) {
            console.error('ICE error:', error);
        }
    });

}