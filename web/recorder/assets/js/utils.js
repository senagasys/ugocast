// utils.js

/**
 * 秒数を受け取り、 'MM:SS' フォーマットの文字列を返します。
 * @param {number} seconds 
 * @returns {string}
 */
export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * イベントログ領域に新しいログエントリを追加します。
 * @param {HTMLElement} logListElement 
 * @param {string} type 
 * @param {string} message 
 * @param {number} timeSec 
 */
export function logEvent(logListElement, type, message, timeSec) {
  if (!logListElement) return;
  
  // 「まだログがありません」メッセージがあれば削除
  const emptyMsg = logListElement.querySelector('.log-empty-msg');
  if (emptyMsg) {
    emptyMsg.remove();
  }
  
  const li = document.createElement('li');
  li.innerHTML = `<span class="time">[${formatTime(timeSec)}]</span> <span class="type">${type}</span>: ${message}`;
  logListElement.prepend(li);
}
