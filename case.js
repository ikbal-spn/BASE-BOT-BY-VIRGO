import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ownerNumbers } from './index.js';
import { createJadiBot, stopJadiBot, listJadiBots } from './jadibot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const casePath = path.join(__dirname, 'case.js');

// Fungsi untuk mengecek apakah pengirim adalah owner
const isOwner = (sender) => {
  if (!sender) return false;
  const normalizedSender = sender.replace(/\D/g, ''); // Hapus semua non-digit
  return ownerNumbers.some(num => {
    const normalizedOwner = num.replace(/\D/g, ''); // Hapus semua non-digit
    return normalizedSender.includes(normalizedOwner);
  });
};

// Ekstrak nomor dari jid
const extractNumber = (jid) => {
  if (!jid) return '';
  return jid.split('@')[0];
};

// Fungsi untuk mengirim pesan reply
const reply = async (sock, message, text) => {
  const remoteJid = message.key.remoteJid;
  await sock.sendMessage(remoteJid, { text }, { quoted: message });
};

// Fungsi untuk menambahkan case baru
const addCase = async (command, caseContent) => {
  try {
    // Baca isi file case.js
    let caseFileContent = fs.readFileSync(casePath, 'utf8');
    
    // Validasi format case
    if (!caseContent.includes('break;')) {
      return 'Case tidak valid! Pastikan case diakhiri dengan break;';
    }
    
    // Format command dan case content
    const formattedCase = `
    case '${command}':
      ${caseContent}
      break;`;
    
    // Temukan posisi untuk menambahkan case baru
    const switchStartIndex = caseFileContent.indexOf('switch (cmd) {');
    const switchEndIndex = caseFileContent.lastIndexOf('}');
    
    // Pastikan indeks ditemukan
    if (switchStartIndex === -1 || switchEndIndex === -1) {
      return 'Struktur file case.js tidak valid!';
    }
    
    // Tambahkan case baru sebelum akhir switch
    const newCaseFileContent = caseFileContent.slice(0, switchEndIndex) + formattedCase + '\n    ' + caseFileContent.slice(switchEndIndex);
    
    // Tulis kembali ke file
    fs.writeFileSync(casePath, newCaseFileContent, 'utf8');
    
    return `Case untuk command '${command}' berhasil ditambahkan!`;
  } catch (error) {
    console.error('Error saat menambahkan case:', error);
    return 'Gagal menambahkan case: ' + error.message;
  }
};

// Fungsi untuk menghapus case
const deleteCase = async (command) => {
  try {
    // Baca isi file case.js
    let caseFileContent = fs.readFileSync(casePath, 'utf8');
    
    // Pattern untuk mencari case
    const casePattern = new RegExp(`case\\s*['"]${command}['"]\\s*:[\\s\\S]*?break;`, 'g');
    
    // Cek apakah case ditemukan
    if (!casePattern.test(caseFileContent)) {
      return `Case untuk command '${command}' tidak ditemukan!`;
    }
    
    // Hapus case
    const newCaseFileContent = caseFileContent.replace(casePattern, '');
    
    // Tulis kembali ke file
    fs.writeFileSync(casePath, newCaseFileContent, 'utf8');
    
    return `Case untuk command '${command}' berhasil dihapus!`;
  } catch (error) {
    console.error('Error saat menghapus case:', error);
    return 'Gagal menghapus case: ' + error.message;
  }
};

// Handler untuk menangani perintah
export const handleCommand = async (sock, message, text) => {
  try {
    // Ekstrak informasi dari pesan
    const sender = message.key.remoteJid;
    const senderNumber = extractNumber(sender);
    const isGroup = sender.endsWith('@g.us');
    
    // Cek prefix
    const prefix = '!';
    if (!text.startsWith(prefix)) return;
    
    // Parse command dan arguments
    const args = text.slice(prefix.length).trim().split(' ');
    const cmd = args.shift().toLowerCase();
    
    // Switch case untuk berbagai perintah
    switch (cmd) {
    case 'menu':
      const menuText = `
*Daftar Perintah Bot*
!ping - Mengecek keaktifan bot
!menu - Menampilkan daftar perintah

*Owner Only*
!jadibot - Menjadikan pengguna sebagai bot
!stopjadibot [nomor] - Menghentikan seseorang jadi bot
!listjadibot - Melihat daftar pengguna yang menjadi bot
!addcase [command] [case] - Menambahkan case baru
!delcase [command] - Menghapus case
      `;
      await reply(sock, message, menuText);
      break;
      
    case 'ping':
      await reply(sock, message, 'Pong! Bot aktif');
      break;
    
    case 'jadibot':
      // Cek apakah user adalah owner
      if (!isOwner(sender)) {
        await reply(sock, message, 'Maaf, hanya owner yang dapat menggunakan fitur ini!');
        return;
      }
      
      // Proses jadibot
      const jadibotResult = await createJadiBot(sock, message);
      await reply(sock, message, jadibotResult);
      break;
      
    case 'stopjadibot':
      // Cek apakah user adalah owner
      if (!isOwner(sender)) {
        await reply(sock, message, 'Maaf, hanya owner yang dapat menggunakan fitur ini!');
        return;
      }
      
      // Cek apakah ada nomor yang diberikan
      if (args.length < 1) {
        await reply(sock, message, 'Silakan masukkan nomor yang ingin dihentikan! Contoh: !stopjadibot 628123456789');
        return;
      }
      
      // Proses stopjadibot
      const stopResult = await stopJadiBot(args[0]);
      await reply(sock, message, stopResult);
      break;
      
    case 'listjadibot':
      // Cek apakah user adalah owner
      if (!isOwner(sender)) {
        await reply(sock, message, 'Maaf, hanya owner yang dapat menggunakan fitur ini!');
        return;
      }
      
      // Proses listjadibot
      const listResult = await listJadiBots();
      await reply(sock, message, listResult);
      break;
      
    case 'addcase':
      // Cek apakah user adalah owner
      if (!isOwner(sender)) {
        await reply(sock, message, 'Maaf, hanya owner yang dapat menggunakan fitur ini!');
        return;
      }
      
      // Cek format perintah
      if (args.length < 2) {
        await reply(sock, message, 'Format salah! Contoh: !addcase test reply(sock, message, "Ini test");');
        return;
      }
      
      // Ambil command dan isi case
      const newCmd = args[0];
      const caseContent = args.slice(1).join(' ');
      
      // Proses tambah case
      const addResult = await addCase(newCmd, caseContent);
      await reply(sock, message, addResult);
      break;
      
    case 'delcase':
      // Cek apakah user adalah owner
      if (!isOwner(sender)) {
        await reply(sock, message, 'Maaf, hanya owner yang dapat menggunakan fitur ini!');
        return;
      }
      
      // Cek format perintah
      if (args.length < 1) {
        await reply(sock, message, 'Format salah! Contoh: !delcase test');
        return;
      }
      
      // Proses hapus case
      const delResult = await deleteCase(args[0]);
      await reply(sock, message, delResult);
      break;
      
    // Case tambahan akan ditambahkan di sini oleh fitur addcase
    }
  } catch (error) {
    console.error('Error handling command:', error);
  }
};
