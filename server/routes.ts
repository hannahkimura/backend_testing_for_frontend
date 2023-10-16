import { ObjectId } from "mongodb";

import { Friend, Post, SkillScore, User, WebSession } from "./app";
import { PostDoc, PostOptions } from "./concepts/post";
import { UserDoc, UserPrefDoc } from "./concepts/user";
import { WebSessionDoc } from "./concepts/websession";
import { Router, getExpressRouter } from "./framework/router";

import Responses from "./responses";

class Routes {
  @Router.get("/session")
  async getSessionUser(session: WebSessionDoc) {
    const user = WebSession.getUser(session);
    return await User.getUserById(user);
  }

  @Router.get("/users")
  async getUsers() {
    return await User.getUsers();
  }

  @Router.get("/users/:username")
  async getUser(username: string) {
    return await User.getUserByUsername(username);
  }

  @Router.post("/users")
  async createUser(
    session: WebSessionDoc,
    username: string,
    password: string,
    gender: string,
    sports: Map<string, boolean>,
    skill: number,
    location: string,
    genderPref: string,
    sportsPref: Map<string, boolean>,
    skillPref: Array<number>,
    locationRange: number,
  ) {
    WebSession.isLoggedOut(session);
    const finished = await User.create(username, password, gender, sports, skill, location, genderPref, sportsPref, skillPref, locationRange);
    const userId = finished.user?._id;
    if (userId) {
      await SkillScore.createScore(userId, 0);
    }
    return { user: { username, password }, profile: Responses.profile(finished.profile), preferences: Responses.preferences(finished.preference) };
  }

  @Router.patch("/users/:_id")
  async updatePreferences(session: WebSessionDoc, update: Partial<UserPrefDoc>) {
    const user = WebSession.getUser(session);
    return await User.updatePreferences(user, update);
  }

  @Router.patch("/users")
  async updateUser(session: WebSessionDoc, update: Partial<UserDoc>) {
    const user = WebSession.getUser(session);
    return await User.update(user, update);
  }

  @Router.delete("/users")
  async deleteUser(session: WebSessionDoc) {
    const user = WebSession.getUser(session);
    WebSession.end(session);
    return await User.delete(user);
  }

  @Router.post("/users/:_id")
  async getUsersThatMatchPref(session: WebSessionDoc) {
    const user = WebSession.getUser(session);
    const userPref = User.getUserPreferencesByUsername(user);

    const genderPref = (await userPref).genderPref;
    const skillPref = (await userPref).skillPref;
    //const locationRange = (await userPref).locationRange;
    const sportPref = (await userPref).sportsPref;

    return { msg: "Filtered Users!", users: await User.filterUsers({ genderPref, skillPref, sportPref }) };
  }

  @Router.post("/login")
  async logIn(session: WebSessionDoc, username: string, password: string) {
    const u = await User.authenticate(username, password);
    WebSession.start(session, u._id);
    return { msg: "Logged in!" };
  }

  @Router.post("/logout")
  async logOut(session: WebSessionDoc) {
    WebSession.end(session);
    return { msg: "Logged out!" };
  }

  @Router.get("/posts")
  async getPosts(session: WebSessionDoc, author?: string) {
    let posts;
    const postsToReturn: Array<PostDoc> = [];
    if (author) {
      const id = (await User.getUserByUsername(author))._id;
      posts = await Post.getByAuthor(id);
      const otherUser = session.user;
      if (!otherUser) {
        throw new Error("can't find other user");
      }
      const otherId = (await User.getUserByUsername(otherUser))._id;
      const areNotFriends = Friend.isNotFriends(id, otherId);

      if (id.toString() === otherId.toString()) {
        //author is the same as user
        return Responses.posts(posts);
      } else if (!areNotFriends) {
        //this is the case where they are friends
        //show all posts with state of friends
        for (const post of posts) {
          if (post.visibility == "friends" || post.visibility == "public") {
            postsToReturn.push(post);
          }
        }
      } else {
        //users are not friends
        for (const post of posts) {
          if (post.visibility == "public") {
            postsToReturn.push(post);
          }
        }
        //show all posts with state of public
      }
    } else {
      //author doesn't exist
      posts = await Post.getPosts({});
    }

    return Responses.posts(postsToReturn);
  }

  @Router.post("/posts")
  async createPost(session: WebSessionDoc, content: string, image?: string, options?: PostOptions, collaborator?: string) {
    const user = WebSession.getUser(session);
    const created = await Post.create(user, content, image, options, collaborator);
    if (!created.post) {
      throw new Error("post wasn't created");
    }

    //NOTE: when stat is added, expiration is set for that stat
    let won = false;
    if (content === "win") {
      won = true;
    }
    if (collaborator) {
      const updatedCollaborator = await User.getUserByUsername(collaborator);
      const _stat = await SkillScore.createStat(user, content, updatedCollaborator._id); //set expiration for stat
      const new_score = await SkillScore.updateScore(user, won, updatedCollaborator._id);

      return { msg: created.msg, post: await Responses.post(created.post), stat: _stat, UserScore: new_score };
    }
  }

  @Router.patch("/posts/:_id")
  async updatePost(session: WebSessionDoc, _id: ObjectId, update: Partial<PostDoc>) {
    const user = WebSession.getUser(session);
    await Post.isAuthor(user, _id);
    //note: in my app, content is stats
    const originalPost = await Post.getPostById(_id);
    await Post.update(_id, update);
    const updatedPost = await Post.getPostById(_id);

    if (originalPost?.content !== updatedPost?.content) {
      const opponent = updatedPost?.collaborator;
      let won;
      if (updatedPost?.content === "win") {
        won = true;
      } else {
        won = false;
      }
      //update users skill score
      if (opponent) {
        const opponentId = (await User.getUserByUsername(opponent))._id;
        await SkillScore.updateScore(user, won, opponentId);
      }
    }

    return await Post.update(_id, update);
  }

  @Router.delete("/posts/:_id")
  async deletePost(session: WebSessionDoc, _id: ObjectId) {
    const user = WebSession.getUser(session);
    await Post.isAuthor(user, _id);
    return Post.delete(_id);
  }
  //INSTEAD OF CALLING EXPIRINGRESOURCE, I AM USING MONGODB (datecreated)
  //this is because each stat expires after a constant year
  //I will argue that expiring resource is still a valid concept,however, because it generalizes the idea of
  //expiring a resource after an inputted amount of time
  // using expiring resource would allow me to update the expiring amount so it isn't fixed; this is ideal,
  //but due to time constraints and the way my app will be used, I only included it as a prototype, and am implemting the concept
  //differently in routes
  @Router.delete("/skillScores/:_id")
  async expireScore(session: WebSessionDoc, _id: ObjectId) {
    const user = WebSession.getUser(session);
    const expiredScore = await SkillScore.getStats(_id);
    const content = expiredScore?.stat;
    const expiredUser = expiredScore?.user1;
    if (expiredUser) {
      await SkillScore.isUser(user, expiredUser);
    }

    let won = false;
    if (content === "win") {
      won = true;
    }
    const otherUser = expiredScore?.user2;
    if (expiredUser) {
      return SkillScore.deleteOldScore(expiredUser, won, otherUser);
    }
  }

  @Router.get("/friends")
  async getFriends(session: WebSessionDoc) {
    const user = WebSession.getUser(session);
    return await User.idsToUsernames(await Friend.getFriends(user));
  }

  @Router.delete("/friends/:friend")
  async removeFriend(session: WebSessionDoc, friend: string) {
    const user = WebSession.getUser(session);
    const friendId = (await User.getUserByUsername(friend))._id;
    return await Friend.removeFriend(user, friendId);
  }

  @Router.get("/connect/requests")
  async getRequests(session: WebSessionDoc) {
    const user = WebSession.getUser(session);
    return await Responses.friendRequests(await Friend.getRequests(user));
  }

  @Router.post("/connect/requests/:to")
  async sendFriendRequest(session: WebSessionDoc, to: string) {
    const user = WebSession.getUser(session);
    const toId = (await User.getUserByUsername(to))._id;
    return await Friend.sendRequest(user, toId);
  }

  @Router.delete("/friend/requests/:to")
  async removeFriendRequest(session: WebSessionDoc, to: string) {
    const user = WebSession.getUser(session);
    const toId = (await User.getUserByUsername(to))._id;
    return await Friend.removeRequest(user, toId);
  }

  @Router.put("/connect/accept/:from")
  async acceptFriendRequest(session: WebSessionDoc, from: string) {
    const user = WebSession.getUser(session);
    const fromId = (await User.getUserByUsername(from))._id;
    return await Friend.acceptRequest(fromId, user);
  }

  @Router.put("/connect/reject/:from")
  async rejectFriendRequest(session: WebSessionDoc, from: string) {
    const user = WebSession.getUser(session);
    const fromId = (await User.getUserByUsername(from))._id;
    return await Friend.rejectRequest(fromId, user);
  }
}

export default getExpressRouter(new Routes());
