import { Filter, ObjectId } from "mongodb";
import DocCollection, { BaseDoc } from "../framework/doc";
import { BadValuesError, NotAllowedError, NotFoundError } from "./errors";

export interface UserDoc extends BaseDoc {
  username: string;
  password: string;
}

export interface UserProfileDoc extends BaseDoc {
  gender: string;
  sports: Map<string, boolean>;
  skill: number;
  location: string;
  username: string;
}

export interface UserPrefDoc extends BaseDoc {
  username: string;
  genderPref: string;
  sportsPref: Map<string, boolean>;
  skillPref: Array<number>;
  locationRange: number;
}

export default class UserConcept {
  public readonly users = new DocCollection<UserDoc>("users");
  public readonly userPreferences = new DocCollection<UserPrefDoc>("userPreferences");
  public readonly userProfiles = new DocCollection<UserProfileDoc>("userProfiles");

  async create(
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
    await this.canCreate(username, password);
    const _id = await this.users.createOne({ username, password });
    const _pref = await this.userPreferences.createOne({ username, genderPref, sportsPref, skillPref, locationRange });
    const _prof = await this.userProfiles.createOne({ username, gender, sports, skill, location });
    return {
      msg: "User created successfully!",
      user: await this.users.readOne({ _id }),
      profile: await this.userProfiles.readOne({ _prof }),
      preference: await this.userPreferences.readOne({ _pref }),
    };
  }

  async getUserPreferencesByUsername(user: ObjectId) {
    const preferences = await this.userPreferences.readOne({ user });
    if (preferences === null) {
      throw new NotFoundError(`User preferences not found!`);
    }
    return preferences;
  }

  async updatePreferences(_id: ObjectId, update: Partial<UserPrefDoc>) {
    if (update.username !== undefined) {
      await this.isUsernameUnique(update.username);
    }
    await this.userPreferences.updateOne({ _id }, update);
  }

  async getUserProfileByUsername(user: ObjectId) {
    const profile = await this.userProfiles.readOne({ user });
    if (profile === null) {
      throw new NotFoundError(`User profile not found!`);
    }
    return profile;
  }

  async updateProfile(_id: ObjectId, update: Partial<UserProfileDoc>) {
    if (update.username !== undefined) {
      await this.isUsernameUnique(update.username);
    }
    await this.userProfiles.updateOne({ _id }, update);
  }

  private sanitizeUser(user: UserDoc) {
    // eslint-disable-next-line
    const { password, ...rest } = user; // remove password
    return rest;
  }

  async getUserById(_id: ObjectId) {
    const user = await this.users.readOne({ _id });
    if (user === null) {
      throw new NotFoundError(`User not found!`);
    }
    return this.sanitizeUser(user);
  }

  async getUserByUsername(username: string) {
    const user = await this.users.readOne({ username });
    if (user === null) {
      throw new NotFoundError(`User not found!`);
    }
    return this.sanitizeUser(user);
  }

  async idsToUsernames(ids: ObjectId[]) {
    const users = await this.users.readMany({ _id: { $in: ids } });

    // Store strings in Map because ObjectId comparison by reference is wrong
    const idToUser = new Map(users.map((user) => [user._id.toString(), user]));
    return ids.map((id) => idToUser.get(id.toString())?.username ?? "DELETED_USER");
  }

  async getUsers(username?: string) {
    // If username is undefined, return all users by applying empty filter
    const filter = username ? { username } : {};
    const users = (await this.users.readMany(filter)).map(this.sanitizeUser);
    return users;
  }

  async filterUsers(query: Filter<UserProfileDoc>) {
    const usersFiltered = this.userProfiles.readMany(query, {
      sort: { dateUpdated: -1 },
    });
    return usersFiltered;
  }

  async authenticate(username: string, password: string) {
    const user = await this.users.readOne({ username, password });
    if (!user) {
      throw new NotAllowedError("Username or password is incorrect.");
    }
    return { msg: "Successfully authenticated.", _id: user._id };
  }

  async update(_id: ObjectId, update: Partial<UserDoc>) {
    if (update.username !== undefined) {
      await this.isUsernameUnique(update.username);
    }
    await this.users.updateOne({ _id }, update);
    return { msg: "User updated successfully!" };
  }

  async delete(_id: ObjectId) {
    await this.users.deleteOne({ _id });
    return { msg: "User deleted!" };
  }

  async userExists(_id: ObjectId) {
    const maybeUser = await this.users.readOne({ _id });
    if (maybeUser === null) {
      throw new NotFoundError(`User not found!`);
    }
  }

  private async canCreate(username: string, password: string) {
    if (!username || !password) {
      throw new BadValuesError("Username and password must be non-empty!");
    }
    await this.isUsernameUnique(username);
  }

  private async isUsernameUnique(username: string) {
    if (await this.users.readOne({ username })) {
      throw new NotAllowedError(`User with username ${username} already exists!`);
    }
  }
}
