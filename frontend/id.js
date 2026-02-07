function uid() {
  return Math.random().toString(36).slice(2, 9);
}

export { uid };
