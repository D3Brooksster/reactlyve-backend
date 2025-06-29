import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as MicrosoftStrategy } from 'passport-microsoft';
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Strategy as TwitterStrategy } from 'passport-twitter';
import { query } from './database.config';
import { AppUser } from '../entity/User'; // Changed User to AppUser

async function handleOAuthLogin(providerField: string, profile: any, done: any) {
  try {
    const providerId = profile.id;
    const email = profile.emails?.[0]?.value ?? '';
    const name = profile.displayName ?? '';
    const picture = profile.photos?.[0]?.value ?? '';

    const { rows: existingUsers } = await query(
      `SELECT * FROM users WHERE ${providerField} = $1`,
      [providerId]
    );

    if (existingUsers.length > 0) {
      const { rows: updatedUsers } = await query(
        `UPDATE users SET last_login = NOW() WHERE ${providerField} = $1 RETURNING *`,
        [providerId]
      );
      return done(null, updatedUsers[0] as AppUser);
    }

    const insertQuery = `INSERT INTO users (
        ${providerField}, email, name, picture, role, last_login,
        max_messages_per_month, current_messages_this_month,
        max_reactions_per_month, reactions_received_this_month,
        max_reactions_per_message, last_usage_reset_date,
        moderate_images, moderate_videos
      ) VALUES ($1, $2, $3, $4, 'guest', NOW(), $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`;

    const newUserResult = await query(insertQuery, [
      providerId,
      email,
      name,
      picture,
      3,
      0,
      9,
      0,
      3,
      '2999-01-19T00:00:00Z',
      true,
      true,
    ]);

    return done(null, newUserResult.rows[0] as AppUser);
  } catch (err) {
    return done(err as Error, undefined);
  }
}

// Serialize (store user ID in session)
passport.serializeUser<any, any>((user: AppUser, done) => {
  // @ts-ignore
  done(null, user.id);
});

// Deserialize (fetch full user from DB)
passport.deserializeUser(async (id: string, done) => {
  try {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, rows[0] as AppUser); // Changed User to AppUser
  } catch (err) {
    done(err, null);
  }
});

passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL!,
  },
  async (accessToken, refreshToken, profile, done) => {
    await handleOAuthLogin('google_id', profile, done);
  }
));

passport.use(new MicrosoftStrategy(
  {
    clientID: process.env.MS_CLIENT_ID!,
    clientSecret: process.env.MS_CLIENT_SECRET!,
    callbackURL: process.env.MS_CALLBACK_URL!,
    scope: ['user.read'],
  },
  async (_accessToken, _refreshToken, profile, done) => {
    await handleOAuthLogin('microsoft_id', profile, done);
  }
));

passport.use(new FacebookStrategy(
  {
    clientID: process.env.FB_CLIENT_ID!,
    clientSecret: process.env.FB_CLIENT_SECRET!,
    callbackURL: process.env.FB_CALLBACK_URL!,
    profileFields: ['id', 'displayName', 'photos', 'email'],
  },
  async (_accessToken, _refreshToken, profile, done) => {
    await handleOAuthLogin('facebook_id', profile, done);
  }
));

passport.use(new TwitterStrategy(
  {
    consumerKey: process.env.TWITTER_CONSUMER_KEY!,
    consumerSecret: process.env.TWITTER_CONSUMER_SECRET!,
    callbackURL: process.env.TWITTER_CALLBACK_URL!,
    includeEmail: true,
  },
  async (_token, _tokenSecret, profile, done) => {
    await handleOAuthLogin('twitter_id', profile, done);
  }
));

export default passport;
