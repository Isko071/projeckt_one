// Решение при синхронизации с облаком: чистая функция, без сети и браузера (тестируется в node).
//   decide({ localFp, baseFp, cloudFp, localPristine }) → 'upload' | 'download' | 'none' | 'conflict'
//   localFp  — отпечаток прогресса на этом устройстве, cloudFp — в облаке (null, если записи ещё нет),
//   baseFp   — отпечаток, с которым это устройство в последний раз синхронизировалось (null, если ещё не было).
(function (root) {
  function decide(s) {
    if (s.cloudFp === null || s.cloudFp === undefined) return 'upload';
    if (s.localFp === s.cloudFp) return 'none';
    if (s.localPristine) return 'download';
    if (s.baseFp !== null && s.baseFp !== undefined) {
      if (s.localFp === s.baseFp) return 'download';  // здесь ничего не менялось, в облаке новее
      if (s.cloudFp === s.baseFp) return 'upload';    // в облаке ничего не менялось, новее здесь
    }
    return 'conflict';                                 // изменились обе стороны
  }
  root.PlatformSyncLogic = { decide: decide };
})(typeof window !== 'undefined' ? window : globalThis);
