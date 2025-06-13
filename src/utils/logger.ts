export const log = (...args: unknown[]) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(...args);
  }
};

export const warn = (...args: unknown[]) => {
  if (process.env.NODE_ENV === 'development') {
    console.warn(...args);
  }
};

export const error = (...args: unknown[]) => {
  console.error(...args);
};
