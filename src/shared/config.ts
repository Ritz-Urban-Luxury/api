const config = () => ({
  env: process.env.NODE_ENV,
  port: Number.parseInt(process.env.PORT, 10) || 3000,
  database: {
    url: process.env.DATABASE_URL,
  },
  termii: {
    key: process.env.TERMII_API_KEY,
    url: process.env.TERMII_API_URL,
    from: process.env.TERMII_FROM,
  },
  sendGrid: {
    from: {
      name: process.env.SENDGRID_DEFAULT_FROM_NAME,
      email: process.env.SENDGRID_DEFAULT_FROM_EMAIL,
    },
    apiKey: process.env.SENDGRID_API_KEY,
  },
  google: {
    IOSOAuthClientID: process.env.GOOGLE_IOS_OAUTH_CLIENT_ID,
    webOAuthClientID: process.env.GOOGLE_WEB_OAUTH_CLIENT_ID,
    androidOAuthClientID: process.env.GOOGLE_ANDROID_OAUTH_CLIENT_ID,
  },
  facebook: {
    appId: process.env.FACEBOOK_APP_ID,
    accessToken: process.env.FACEBOOK_ACCESS_TOKEN,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN,
  },
  cloudinary: {
    name: process.env.CLOUDINARY_NAME,
    key: process.env.CLOUDINARY_KEY,
    secret: process.env.CLOUDINARY_SECRET,
  },
  redis: {
    url: process.env.REDIS_URL,
    password: process.env.REDIS_PASSWORD,
  },
  cache: {
    ttl: Number.parseInt(process.env.CACHE_TTL, 10) || 0,
  },
  monnify: {
    apiKey: process.env.MONNIFY_API_KEY,
    secret: process.env.MONNIFY_SECRET,
    contractCode: process.env.MONNIFY_CONTRACT_CODE,
    apiUrl: process.env.MONNIFY_API_URL,
  },
  turnOffSMS: process.env.TURN_OFF_SMS === 'true',
});

export type Configuration = ReturnType<typeof config>;

export default config;
