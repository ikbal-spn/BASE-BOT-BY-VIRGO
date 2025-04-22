import pkg from '@whiskeysockets/baileys';
const { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason } = pkg;
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import NodeCache from 'node-cache';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const msgRetryCounterCache = new NodeCache();

// Object untuk menyimpan sesi jadibot
const jadiBots = {};

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

// Fungsi untuk membuat jadibot
export const createJadiBot = async (mainSock, message) => {
  try {
    const remoteJid = message.key.remoteJid;
    
    // Minta user untuk memasukkan nomor telepon
    await mainSock.sendMessage(remoteJid, { text: "Silahkan balas pesan ini dengan nomor WhatsApp yang akan dijadikan bot (dengan kode negara, contoh: 6281234567890)" });
    
    // Menunggu balasan nomor telepon dari user
    const getMsgPhoneNumber = await new Promise((resolve) => {
      const responseTimeout = setTimeout(() => {
        resolve(null);
      }, 60000); // Timeout 60 detik
      
      const phoneNumberListener = async (m) => {
        try {
          const msg = m.messages[0];
          if (!msg.message) return;
          
          // Cek apakah pesan adalah balasan dari pesan sebelumnya
          const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
          if (quotedMsg && msg.key.remoteJid === remoteJid) {
            clearTimeout(responseTimeout);
            mainSock.ev.off('messages.upsert', phoneNumberListener);
            
            const phoneNumber = msg.message.conversation || 
                              msg.message.extendedTextMessage?.text || '';
            
            resolve(phoneNumber);
          }
        } catch (err) {
          console.error("Error in phone number listener:", err);
        }
      };
      
      mainSock.ev.on('messages.upsert', phoneNumberListener);
    });
    
    if (!getMsgPhoneNumber || !getMsgPhoneNumber.trim()) {
      return "Nomor tidak valid atau waktu habis. Silakan coba lagi.";
    }
    
    const phoneNumber = getMsgPhoneNumber.trim();
    
    // Cek apakah nomor sudah terdaftar sebagai jadibot
    if (jadiBots[phoneNumber]) {
      return `Nomor ${phoneNumber} sudah terdaftar sebagai bot!`;
    }
    
    // Buat folder session untuk jadibot
    const sessionFolder = `./jadibots/${phoneNumber}`;
    if (!fs.existsSync(sessionFolder)) {
      fs.mkdirSync(sessionFolder, { recursive: true });
    }
    
    // Setup auth state
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    
    // Buat koneksi WhatsApp untuk jadibot
    const sock = makeWASocket({
      printQRInTerminal: false,
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
    
    // Request pairing code
    const pairingCode = await sock.requestPairingCode(phoneNumber);
    
    // Kirim kode pairing ke user
    await mainSock.sendMessage(remoteJid, { 
      text: `Kode Pairing untuk nomor ${phoneNumber} adalah: ${pairingCode}\n\nMasukkan kode tersebut di WhatsApp Anda` 
    });
    
    // Event handlers untuk jadibot
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        
        console.log(`[JadiBot ${phoneNumber}] Koneksi terputus`);
        
        if (shouldReconnect) {
          console.log(`[JadiBot ${phoneNumber}] Mencoba menghubungkan kembali...`);
          // Restart bot jika terputus
          createJadiBotSession(phoneNumber, sessionFolder);
        } else {
          console.log(`[JadiBot ${phoneNumber}] Koneksi berakhir karena logout`);
          delete jadiBots[phoneNumber];
          if (fs.existsSync(sessionFolder)) {
            fs.rmSync(sessionFolder, { recursive: true, force: true });
          }
          
          // Kirim notifikasi ke main bot
          await mainSock.sendMessage(remoteJid, { 
            text: `Bot untuk nomor ${phoneNumber} telah logout dan dihapus dari sistem.` 
          });
        }
      } else if (connection === 'open') {
        console.log(chalk.green.bold(`\n[✓] JadiBot ${phoneNumber} berhasil terhubung ke WhatsApp!`));
        
        // Simpan instance sock ke jadiBots
        jadiBots[phoneNumber] = {
          sock,
          sessionFolder,
          createdAt: new Date()
        };
        
        // Kirim notifikasi ke main bot
        await mainSock.sendMessage(remoteJid, { 
          text: `Bot untuk nomor ${phoneNumber} berhasil terhubung!\n\nKetik !stopjadibot ${phoneNumber} untuk menghentikan.` 
        });
      }
    });
    
    // Tambahkan message handler sederhana untuk jadibot
    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg.message) return;
        
        const remoteJid = msg.key.remoteJid;
        if (remoteJid === 'status@broadcast') return;
        
        const pushName = msg.pushName || 'User';
        const messageType = Object.keys(msg.message)[0];
        
        // Handle text messages - tambahkan tag [JadiBot]
        if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
          const textMessage = messageType === 'conversation' 
            ? msg.message.conversation 
            : msg.message.extendedTextMessage.text;
          
          console.log(`[JadiBot ${phoneNumber}][${pushName}]: ${textMessage}`);
          
          // Contoh respons sederhana untuk cek jadibot aktif
          if (textMessage.toLowerCase() === '!ping') {
            await sock.sendMessage(remoteJid, { text: `[JadiBot ${phoneNumber}] Pong! Bot aktif` }, { quoted: msg });
          }
        }
      } catch (error) {
        console.error(`[JadiBot ${phoneNumber}] Error processing message:`, error);
      }
    });
    
    return `Proses pembuatan bot untuk nomor ${phoneNumber} berhasil dimulai. Masukkan kode pairing yang dikirimkan di WhatsApp Anda.`;
  } catch (error) {
    console.error('Error saat membuat jadibot:', error);
    return 'Gagal membuat jadibot: ' + error.message;
  }
};

// Fungsi untuk menginisiasi kembali jadibot yang sudah ada
const createJadiBotSession = async (phoneNumber, sessionFolder) => {
  try {
    // Setup auth state
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    
    // Buat koneksi WhatsApp untuk jadibot
    const sock = makeWASocket({
      printQRInTerminal: false,
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
    
    // Event handlers untuk jadibot
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        
        console.log(`[JadiBot ${phoneNumber}] Koneksi terputus`);
        
        if (shouldReconnect) {
          console.log(`[JadiBot ${phoneNumber}] Mencoba menghubungkan kembali...`);
          setTimeout(() => {
            createJadiBotSession(phoneNumber, sessionFolder);
          }, 3000);
        } else {
          console.log(`[JadiBot ${phoneNumber}] Koneksi berakhir karena logout`);
          delete jadiBots[phoneNumber];
          if (fs.existsSync(sessionFolder)) {
            fs.rmSync(sessionFolder, { recursive: true, force: true });
          }
        }
      } else if (connection === 'open') {
        console.log(chalk.green.bold(`\n[✓] JadiBot ${phoneNumber} berhasil terhubung kembali ke WhatsApp!`));
        
        // Simpan instance sock ke jadiBots
        jadiBots[phoneNumber] = {
          sock,
          sessionFolder,
          createdAt: new Date()
        };
      }
    });
    
    // Tambahkan message handler sederhana untuk jadibot
    sock.ev.on('messages.upsert', async (m) => {
      try {
        const msg = m.messages[0];
        if (!msg.message) return;
        
        const remoteJid = msg.key.remoteJid;
        if (remoteJid === 'status@broadcast') return;
        
        const pushName = msg.pushName || 'User';
        const messageType = Object.keys(msg.message)[0];
        
        // Handle text messages
        if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
          const textMessage = messageType === 'conversation' 
            ? msg.message.conversation 
            : msg.message.extendedTextMessage.text;
          
          console.log(`[JadiBot ${phoneNumber}][${pushName}]: ${textMessage}`);
          
          // Contoh respons sederhana untuk cek jadibot aktif
          if (textMessage.toLowerCase() === '!ping') {
            await sock.sendMessage(remoteJid, { text: `[JadiBot ${phoneNumber}] Pong! Bot aktif` }, { quoted: msg });
          }
        }
      } catch (error) {
        console.error(`[JadiBot ${phoneNumber}] Error processing message:`, error);
      }
    });
    
    return sock;
  } catch (error) {
    console.error(`Error saat membuat session jadibot ${phoneNumber}:`, error);
    return null;
  }
};

// Fungsi untuk menghentikan jadibot
export const stopJadiBot = async (phoneNumber) => {
  try {
    // Cek apakah nomor terdaftar sebagai jadibot
    if (!jadiBots[phoneNumber]) {
      return `Nomor ${phoneNumber} tidak terdaftar sebagai bot!`;
    }
    
    // Ambil informasi jadibot
    const { sock, sessionFolder } = jadiBots[phoneNumber];
    
    // Hapus dari daftar jadibot
    delete jadiBots[phoneNumber];
    
    // Hapus session folder
    if (fs.existsSync(sessionFolder)) {
      fs.rmSync(sessionFolder, { recursive: true, force: true });
    }
    
    return `Bot untuk nomor ${phoneNumber} berhasil dihentikan!`;
  } catch (error) {
    console.error('Error saat menghentikan jadibot:', error);
    return 'Gagal menghentikan jadibot: ' + error.message;
  }
};

// Fungsi untuk menampilkan daftar jadibot
export const listJadiBots = async () => {
  try {
    // Cek apakah ada jadibot yang aktif
    const botNumbers = Object.keys(jadiBots);
    if (botNumbers.length === 0) {
      return 'Tidak ada bot yang aktif!';
    }
    
    // Buat daftar jadibot
    let message = '*Daftar Jadibot Aktif*\n\n';
    botNumbers.forEach((number, index) => {
      const { createdAt } = jadiBots[number];
      const botCreatedTime = createdAt.toLocaleString();
      message += `${index + 1}. Nomor: ${number}\n   - Dibuat pada: ${botCreatedTime}\n\n`;
    });
    
    return message;
  } catch (error) {
    console.error('Error saat menampilkan daftar jadibot:', error);
    return 'Gagal menampilkan daftar jadibot: ' + error.message;
  }
};

// Fungsi untuk me-restore sesi jadibot yang sudah ada
export const restoreJadiBots = async () => {
  try {
    // Cek apakah folder jadibots ada
    const jadibotFolder = './jadibots';
    if (!fs.existsSync(jadibotFolder)) {
      fs.mkdirSync(jadibotFolder, { recursive: true });
      return;
    }
    
    // Baca folder di dalam jadibots
    const folders = fs.readdirSync(jadibotFolder, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    if (folders.length === 0) return;
    
    console.log(chalk.blue.bold(`[INFO] Mengembalikan ${folders.length} sesi jadibot...`));
    
    // Restore setiap sesi
    for (const folder of folders) {
      const phoneNumber = folder;
      const sessionFolder = path.join(jadibotFolder, folder);
      
      // Cek apakah ada file creds.json
      if (!fs.existsSync(path.join(sessionFolder, 'creds.json'))) {
        console.log(`[WARNING] Folder ${folder} tidak memiliki file creds.json, melewati...`);
        continue;
      }
      
      // Buat koneksi jadibot
      console.log(`[INFO] Mencoba mengembalikan sesi untuk bot ${phoneNumber}...`);
      await createJadiBotSession(phoneNumber, sessionFolder);
    }
    
    console.log(chalk.green.bold(`[✓] Proses restore jadibot selesai!`));
  } catch (error) {
    console.error('Error saat me-restore jadibot:', error);
  }
};

// Panggil restoreJadiBots saat aplikasi dimulai
restoreJadiBots();
