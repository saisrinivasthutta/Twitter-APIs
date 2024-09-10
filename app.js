const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error ${error.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

//Authentication
const authentication = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken) {
    jwt.verify(jwtToken, "SECRET_KEY", (error, payload) => {
      if (error) {
        response.status(401).send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  } else {
    response.status(401).send("Invalid JWT Token");
  }
};

//Get Following Ids of a User
const getFollowingIdsOfUser = async (userId) => {
  const getFollowingIdsOfUserQuery =
    "select following_user_id from follower where follower_user_id = ?;";
  const followingData = await db.all(getFollowingIdsOfUserQuery, [userId]);
  const followingIds = followingData.map((each) => each.following_user_id);
  return followingIds;
};

const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `
        select * from tweet inner join follower on tweet.user_id = follower.following_user_id 
        where tweet.tweet_id = ? and follower.follower_user_id = ?;
    `;
  const tweet = await db.get(getTweetQuery, [tweetId, userId]);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//API 1 Register
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `select * from user where username = ?`;
  const userDbDetails = await db.get(getUserQuery, [username]);

  if (userDbDetails !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createNewUserQuery = `insert into user(username, password, name, gender) values(?, ?, ?, ?);`;
      await db.run(createNewUserQuery, [
        username,
        hashedPassword,
        name,
        gender,
      ]);
      response.send("User created successfully");
    }
  }
});

//API 2 Login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;

  const userDbQuery = `select * from user where username = ?;`;
  const userDetails = await db.get(userDbQuery, [username]);
  if (userDetails === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      userDetails.password
    );
    if (isPasswordMatched) {
      const payload = {
        username,
        userId: userDetails.user_id,
      };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      response.send({ jwtToken });
      console.log(jwtToken);
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//API 3 User Tweets
app.get("/user/tweets/feed/", authentication, async (request, response) => {
  const { userId } = request;
  const followingIds = await getFollowingIdsOfUser(userId);
  const placeholders = followingIds.map(() => "?").join(", ");
  const getTweetsQuery = `
    select username, tweet, date_time as dateTime
     from user INNER JOIN tweet ON user.user_id = tweet.user_id
      where user.user_id in (${placeholders} )
     order by date_time desc limit 4;`;
  const tweets = await db.all(getTweetsQuery, followingIds);
  response.send(tweets);
});

//API 4 Followers
app.get("/user/following/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getFollowingUsersQuery = `SELECT name FROM follower
    INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower_user_id = ?;
    `;

  const followingPeople = await db.all(getFollowingUsersQuery, userId);
  response.send(followingPeople);
});

//API 5 Followers
app.get("/user/followers/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getFollowingUsersQuery = `SELECT name FROM follower
    INNER JOIN user ON user.user_id = follower.follower_user_id
    WHERE following_user_id = ?;
    `;

  const followingPeople = await db.all(getFollowingUsersQuery, userId);
  response.send(followingPeople);
});

//API 6 Tweet
app.get(
  "/tweets/:tweetId/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const getTweetDetailsQuery = `select tweet,
     (select count() from like where tweet_id = ?) as likes,  
     (select count() from reply where tweet_id = ?) as replies,
     date_time as dateTime from tweet where tweet_id = ?;`;
    const tweetDetails = await db.get(
      getTweetDetailsQuery,
      tweetId,
      tweetId,
      tweetId
    );
    response.send(tweetDetails);
  }
);

//API 7 Likes
app.get(
  "/tweets/:tweetId/likes/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const getLikesQuery = `
    select username from user inner join like on user.user_id = like.user_id where tweet_id = ?;
    `;
    const likesData = await db.all(getLikesQuery, tweetId);
    const likes = likesData.map((like) => like.username);
    console.log(likes);
    response.send({ likes });
  }
);

//API 8 Replies
app.get(
  "/tweets/:tweetId/replies/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const getLikesQuery = `
    select name, reply from reply inner join user on user.user_id = reply.user_id where tweet_id = ?;
    `;
    const replies = await db.all(getLikesQuery, tweetId);
    console.log(replies);
    response.send({ replies });
  }
);

//API 9 Tweets

app.get("/user/tweets/", authentication, async (request, response) => {
  const { userId } = request;
  const getTweetsQuery = `
    SELECT tweet,
    COUNT(DISTINCT like_id) AS likes,
    COUNT(DISTINCT reply_id) AS replies,
    date_time AS dateTime
    FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.user_id = ${userId}
    GROUP BY tweet.tweet_id;`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

//API 10 post a Tweet
app.post("/user/tweets/", authentication, async (request, response) => {
  const { userId, username } = request;
  const { tweet } = request.body;
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweetQuery = `insert into tweet(tweet, user_id, date_time) values(?, ?, ?);`;
  db.run(createTweetQuery, tweet, userId, dateTime);
  response.send("Created a Tweet");
});

//API 11 Delete Tweet
app.delete("/tweets/:tweetId/", authentication, async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getTheTweetQuery = `SELECT * FROM tweet WHERE user_id = '${userId}' AND tweet_id = '${tweetId}';`;
  const tweet = await db.get(getTheTweetQuery);
  console.log(tweet);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id ='${tweetId}';`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
