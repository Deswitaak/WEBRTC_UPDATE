const fs = require('fs');
const os = require('os');
const selfsigned = require('selfsigned');

// Ambil semua IPv4 lokal (Wi-Fi/LAN) otomatis, supaya sertifikat
// cocok dengan IP yang dipakai device lain untuk membuka server.
function getLocalIPs() {
    const ips = new Set(['127.0.0.1']);
    for (const list of Object.values(os.networkInterfaces())) {
        for (const iface of list || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.add(iface.address);
            }
        }
    }
    return [...ips];
}

async function generateCertificate() {
    const attributes = [
        { name: 'commonName', value: 'localhost' }
    ];

    const ips = getLocalIPs();

    const options = {
        days: 365,
        keySize: 2048,
        extensions: [
            {
                name: 'subjectAltName',
                altNames: [
                    { type: 2, value: 'localhost' },
                    ...ips.map(ip => ({ type: 7, ip }))
                ]
            }
        ]
    };

    const pems = await selfsigned.generate(attributes, options);

    fs.mkdirSync('ssl', { recursive: true });
    fs.writeFileSync('ssl/key.pem', pems.private);
    fs.writeFileSync('ssl/cert.pem', pems.cert);

    console.log('Sertifikat berhasil dibuat untuk:', ['localhost', ...ips].join(', '));
    console.log('File: ssl/key.pem');
    console.log('File: ssl/cert.pem');
}

generateCertificate().catch(console.error);