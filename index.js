import pkg from '@whiskeysockets/baileys';
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, DisconnectReason } = pkg;
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import chalk from 'chalk';
import NodeCache from 'node-cache';
import { handleCommand } from './case.js';
import { createJadiBot, stopJadiBot, listJadiBots } from './jadibot.js';
import { watchFiles } from './fileWatcher.js';

// Konfigurasi dasar
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const msgRetryCounterCache = new NodeCache();
const sessionFolder = './session';

// Owner numbers (modify with your own)
export const ownerNumbers = ['6281234567890']; // Add your number here

// Fungsi untuk prompt input dari user
const question = (text) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(text, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

// Handler pesan sederhana
const messageHandler = async (sock, msg) => {
  try {
    const message = msg.messages[0];
    
    if (!message.message) return;
    
    const remoteJid = message.key.remoteJid;
    if (remoteJid === 'status@broadcast') return;
    
    const pushName = message.pushName || 'User';
    const messageType = Object.keys(message.message)[0];
    
    // Handle text messages
    if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
      const textMessage = messageType === 'conversation' 
        ? message.message.conversation 
        : message.message.extendedTextMessage.text;
      
      console.log(`[${pushName}]: ${textMessage}`);
      
      // Teruskan ke handler command di case.js
      await handleCommand(sock, message, textMessage);
    }
  } catch (error) {
    console.error('Error processing message:', error);
  }
};

// Fungsi untuk memulai koneksi WhatsApp
export const startBot = async () => {
  // Pastikan folder session ada
  if (!fs.existsSync(sessionFolder)) {
    fs.mkdirSync(sessionFolder, { recursive: true });
    console.log('Folder session dibuat');
  }
  // Setup auth state
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  
  // Buat koneksi WhatsApp - setting printQRInTerminal ke false untuk tidak menampilkan QR
  const sock = makeWASocket({
    printQRInTerminal: false, // Tidak menampilkan QR
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    browser: ["Windows", "Chrome", "20.0.04"],
    version: [2, 3000, 1020608496],
    logger: pino({ level: 'silent' }),
    msgRetryCounterCache,
    defaultQueryTimeoutMs: 0,
    connectTimeoutMs: 60000,
  });

  // Langsung inisialisasi pairing code
  const sessionFiles = fs.readdirSync(sessionFolder);
  const freshSession = sessionFiles.length === 0 || !fs.existsSync(path.join(sessionFolder, 'creds.json'));
  
  if (freshSession) {
    try {
      // Cetak pembatas untuk dokumentasi
      console.log("========================================");
      console.log("Login menggunakan Pairing Code");
      console.log("========================================");
      
      // Prompt user untuk nomor telepon
      const phoneNumber = await question("Masukkan nomor WhatsApp (dengan kode negara, contoh: 6281234567890): ");
      
      if (!phoneNumber?.trim()) {
        console.log("Nomor tidak valid. Silakan restart program.");
        process.exit(1);
      }
      
      console.log("Meminta kode pairing...");
      
      // Request pairing code
      const pairingCode = await sock.requestPairingCode(phoneNumber.trim());
      
      console.log("========================================");
      console.log(`Kode Pairing Anda: ${pairingCode}`);
      console.log("Masukkan kode tersebut di WhatsApp Anda");
      console.log("========================================");
    } catch (error) {
      console.error("Gagal mendapatkan pairing code:", error);
      console.error(error);
      process.exit(1);
    }
  }

  // Event handlers
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      
      console.log('Koneksi terputus karena:', lastDisconnect.error);
      
      if (shouldReconnect) {
        console.log('Mencoba menghubungkan kembali...');
        setTimeout(() => {
          startBot();
        }, 3000);
      } else {
        console.log('Koneksi berakhir karena logout');
        if (fs.existsSync(sessionFolder)) {
          fs.rmSync(sessionFolder, { recursive: true, force: true });
        }
      }
    } else if (connection === 'open') {
      console.log(chalk.green.bold('\n[✓] Bot berhasil terhubung ke WhatsApp!'));
      console.log(chalk.yellow('Bot siap digunakan. Ketik !menu di WhatsApp untuk melihat perintah yang tersedia.\n'));
      
      // Mulai file watcher
      watchFiles(sock);
    }
  });

  // Handle pesan masuk
  sock.ev.on('messages.upsert', async (m) => {
    try {
      await messageHandler(sock, m);
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  return sock;
};

// Mulai bot
startBot().catch(err => {
  console.error('Error saat menjalankan bot:', err);
  process.exit(1);
});
