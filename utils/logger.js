function writeLog(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };
  const write = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  write(JSON.stringify(entry));
}

module.exports = {
  info: (event, fields) => writeLog('info', event, fields),
  warn: (event, fields) => writeLog('warn', event, fields),
  error: (event, fields) => writeLog('error', event, fields),
};
