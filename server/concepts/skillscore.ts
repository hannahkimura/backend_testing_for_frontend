import { Filter, ObjectId } from "mongodb";
import DocCollection, { BaseDoc } from "../framework/doc";
import { NotAllowedError, NotFoundError } from "./errors";

export interface SkillScoreDoc extends BaseDoc {
  score: number;
  user1: ObjectId;
}

export interface StatDoc extends BaseDoc {
  stat: string;
  user1: ObjectId;
  user2: ObjectId;
}

export default class SkillScoreConcept {
  public readonly userScores = new DocCollection<SkillScoreDoc>("skillScores");
  public readonly stats = new DocCollection<StatDoc>("stats");

  //I think I need a new way to calculate the scores

  async getScore(query: Filter<SkillScoreDoc>) {
    const score = await this.userScores.readOne(query, {
      sort: { dateUpdated: -1 },
    });
    return score;
  }
  async isUser(user: ObjectId, _id: ObjectId) {
    const stat = await this.stats.readOne({ _id });
    if (!stat) {
      throw new StatNotFound(_id);
    }
    if (stat.user1.toString() !== user.toString()) {
      throw new StatUserNotMatchError(user, _id);
    }
  }

  async getStats(query: Filter<StatDoc>) {
    const score = await this.stats.readOne(query, {
      sort: { dateUpdated: -1 },
    });
    return score;
  }

  async getStatsById(_id: ObjectId) {
    const stat = await this.getStats({ _id });
    if (!stat) {
      throw new StatNotFound(_id);
    }
  }

  async getScoreById(_id: ObjectId) {
    const score = await this.getScore({ _id });
    if (!score) {
      throw new SkillScoreNotFoundError(_id);
    }
    return await this.getScore({ _id });
  }

  async createScore(user1: ObjectId, score: number) {
    await this.userScores.createOne({ score, user1 });
  }

  //this function is pretty much the opposite of the update score function
  async deleteOldScore(user: ObjectId, won: boolean, otherUser?: ObjectId) {
    //first check if user is in userScores
    if (!otherUser) {
      return;
    }
    const userScore = await this.getScoreById(user);
    if (!userScore) {
      throw new SkillScoreNotFoundError(user);
    }
    const otherUserScore = await this.getScoreById(otherUser);
    if (!otherUserScore) {
      throw new SkillScoreNotFoundError(otherUser);
    }

    const userScoreNum = userScore.score;
    const otherScoreNum = otherUserScore.score;
    let newScore;
    let opponentNewScore;
    if (userScoreNum < otherScoreNum) {
      if (won) {
        newScore = userScoreNum - 0.2;
        opponentNewScore = otherScoreNum + 0.2;
      } else {
        newScore = userScoreNum;
        opponentNewScore = otherScoreNum - 0.01;
      }
    } else if (userScoreNum === otherScoreNum) {
      if (won) {
        newScore = userScoreNum - 0.1;
        opponentNewScore = otherScoreNum + 0.1;
      } else {
        opponentNewScore = otherScoreNum + 0.1;
        newScore = userScoreNum - 0.1;
      }
    } else {
      //userScoreNum>otherScoreNum
      if (won) {
        newScore = userScoreNum + 0.2;
        opponentNewScore = otherScoreNum - 0.2;
      } else {
        opponentNewScore = otherScoreNum;
        newScore = userScoreNum - 0.01;
      }
    }

    if (newScore > 5) {
      newScore = 5;
    }
    if (opponentNewScore > 5) {
      opponentNewScore = 5;
    }
    if (newScore < 0) {
      newScore = 0;
    }
    if (opponentNewScore < 0) {
      opponentNewScore = 0;
    }
  }
  private async getUnexpired() {
    const expireDate = new Date(); // now
    expireDate.setDate(expireDate.getDate() - 7); // 7 days ago
    // Now all items on or after expireDate are unexpired (last 7 days)
    const valid_stats = await this.stats.readMany({ dateCreated: { $gte: expireDate } });
    return valid_stats;
  }

  async createStat(user1: ObjectId, stat: string, user2?: ObjectId) {
    const _id = await this.stats.createOne({ stat, user1, user2 });
    return { msg: "Stat successfully created!", stat: await this.stats.readOne({ _id }) };
  }

  async updateScore(user: ObjectId, won: boolean, otherUser?: ObjectId) {
    //new result is a dict that maps the result "win or lose" to the other user.
    //depending on the other user's score, user's score will go up or down
    //score can be between 0 and 5 (0 is the start, 5 is the highest)

    //first check if user is in userScores
    const userScore = await this.getScoreById(user);
    if (!userScore) {
      throw new SkillScoreNotFoundError(user);
    }
    let otherUserScore;
    if (otherUser) {
      otherUserScore = await this.getScoreById(otherUser);
      if (!otherUserScore) {
        throw new SkillScoreNotFoundError(otherUser);
      }
    }

    const userScoreNum = userScore.score;
    const otherScoreNum = otherUserScore?.score;
    let newScore;
    let opponentNewScore;
    if (!otherScoreNum) {
      throw new NotFoundError("Opponent score doesn't exist");
    }
    if (userScoreNum < otherScoreNum) {
      if (won) {
        newScore = userScoreNum + 0.2;
        opponentNewScore = otherScoreNum - 0.2;
      } else {
        newScore = userScoreNum;
        opponentNewScore = otherScoreNum + 0.01;
      }
    } else if (userScoreNum === otherScoreNum) {
      if (won) {
        newScore = userScoreNum + 0.1;
        opponentNewScore = otherScoreNum - 0.1;
      } else {
        opponentNewScore = otherScoreNum - 0.1;
        newScore = userScoreNum + 0.1;
      }
    } else {
      //userScoreNum>otherScoreNum
      if (won) {
        newScore = userScoreNum - 0.2;
        opponentNewScore = otherScoreNum + 0.2;
      } else {
        opponentNewScore = otherScoreNum;
        newScore = userScoreNum + 0.01;
      }
    }

    if (newScore > 5) {
      newScore = 5;
    }
    if (opponentNewScore > 5) {
      opponentNewScore = 5;
    }
    if (newScore < 0) {
      newScore = 0;
    }
    if (opponentNewScore < 0) {
      opponentNewScore = 0;
    }
  }
}
export class StatNotFound extends NotFoundError {
  constructor(public readonly _id: ObjectId) {
    super("Stat not found", _id);
  }
}

export class SkillScoreNotFoundError extends NotFoundError {
  constructor(public readonly _id: ObjectId) {
    super("SkillScoreNotFound not found", _id);
  }
}

export class StatUserNotMatchError extends NotAllowedError {
  constructor(
    public readonly user: ObjectId,
    public readonly _id: ObjectId,
  ) {
    super("{0} is not the same as the stat user {1}", user, _id);
  }
}
