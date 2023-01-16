const config = () => ({
  env: process.env.NODE_ENV,
  port: Number.parseInt(process.env.PORT, 10) || 3000,
  database: {
    url: process.env.DATABASE_URL,
  },
  termii: {
    key: process.env.TERMII_API_KEY,
    url: process.env.TERMII_API_URL,
  },
});

export type Configuration = ReturnType<typeof config>;

export default config;
