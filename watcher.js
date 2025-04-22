import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fungsi untuk memwatch file dan folder
export const watchFiles = (sock) => {
  console.log(chalk.blue('[INFO] File watcher aktif, perubahan file akan otomatis diterapkan'));
  
  // Daftar file yang akan di-watch
  const watchedFiles = [
    './case.js',
    './jadibot.js',
    './fileWatcher.js'
  ];
  
  // Buat watcher
  const watcher = chokidar.watch(watchedFiles, {
    ignored: /(^|[\/\\])\../, // abaikan file hidden
    persistent: true
  });
  
  // Event listener untuk perubahan file
  watcher.on('change', async (filePath) => {
    try {
      const fileName = path.basename(filePath);
      console.log(chalk.yellow(`[FILE] Perubahan terdeteksi pada file ${fileName}`));
      
      // Clear cache untuk file yang diubah
      const modulePath = path.resolve(filePath);
      delete require.cache[modulePath];
      
      // Jika ada owner online, kirim notifikasi
      if (sock) {
        // Cek koneksi owner berdasarkan data dari sock
        const ownerJIDs = sock.user?.contacts?.filter(contact => {
          // Implementasi cek owner bisa disesuaikan
          return true; // Sementara, anggap semua kontak adalah owner
        });
        
        if (ownerJIDs && ownerJIDs.length > 0) {
          for (const ownerJID of ownerJIDs) {
            await sock.sendMessage(ownerJID.id, {
              text: `File ${fileName} telah diperbarui dan diterapkan secara otomatis.`
            });
          }
        }
      }
      
      console.log(chalk.green(`[✓] File ${fileName} berhasil diperbarui`));
    } catch (error) {
      console.error(`Error saat memproses perubahan file:`, error);
    }
  });
  
  // Handle error
  watcher.on('error', error => {
    console.error(`[ERROR] Watcher error:`, error);
  });
  
  return watcher;
};
