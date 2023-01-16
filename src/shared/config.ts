const config = () => ({
  env: process.env.NODE_ENV,
  port: Number.parseInt(process.env.PORT, 10) || 3000,
  database: {
    url: process.env.DATABASE_URL,
  },
});

export type Configuration = ReturnType<typeof config>;

export default config;
