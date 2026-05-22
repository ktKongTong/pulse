export function tabKey(sessionId: string, tabId: string) {
  return `${sessionId}:${tabId}`;
}

export function splitTabKey(key: string) {
  const index = key.indexOf(":");
  return {
    sessionId: key.slice(0, index),
    tabId: key.slice(index + 1),
  };
}
