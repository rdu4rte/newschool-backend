import { Injectable, OnModuleInit } from '@nestjs/common';
import { AchievementRepository } from '../repository/achievement.repository';
import { StartEventShareCourseRuleDTO } from '../dto/start-event-share-course.dto';
import { EventNameEnum } from '../enum/event-name.enum';
import { BadgeRepository } from '../repository/badge.repository';
import * as PubSub from 'pubsub-js';
import { CourseTaken } from '../../CourseModule/entity/course.taken.entity';
import { CourseTakenStatusEnum } from '../../CourseModule/enum/enum';
import { Achievement } from '../entity/achievement.entity';
import { StartEventRateAppRuleDTO } from '../dto/start-event-rate-app.dto';
import { User } from '../../UserModule/entity/user.entity';
import { Badge } from '../entity/badge.entity';
import { UserRepository } from '../../UserModule/repository/user.repository';
import { CourseRepository } from '../../CourseModule/repository/course.repository';
import { CourseTakenRepository } from '../../CourseModule/repository/course.taken.repository';
export interface SharedCourseRule {
  courseId: string;
}

export interface InviteUserRewardData {
  inviteKey: string;
}

@Injectable()
export class UserRewardsService implements OnModuleInit {
  constructor(
    private readonly achievementRepository: AchievementRepository,
    private readonly badgeRepository: BadgeRepository,
    private readonly userRepository: UserRepository,
    private readonly courseRepository: CourseRepository,
    private readonly courseTakenRepository: CourseTakenRepository,
  ) {}

  onModuleInit(): void {
    PubSub.subscribe(
      EventNameEnum.USER_REWARD_SHARE_COURSE,
      async (message: string, data: StartEventShareCourseRuleDTO) => {
        await this.shareCourseReward(data);
      },
    );
    PubSub.subscribe(
      EventNameEnum.USER_REWARD_RATE_APP,
      async (message: string, data: StartEventRateAppRuleDTO) => {
        await this.rateAppReward(data);
      },
    );
    PubSub.subscribe(
      EventNameEnum.USER_REWARD_INVITE_USER,
      async (message: string, data: InviteUserRewardData) => {
        await this.inviteUserReward(data);
      },
    );
    PubSub.subscribe(
      EventNameEnum.USER_REWARD_COMPLETE_REGISTRATION,
      async (message: string, data) => {
        await this.completeRegistrationReward(data);
      },
    );
  }

  private async shareCourseReward({
    courseId,
    userId,
    platform,
  }: StartEventShareCourseRuleDTO): Promise<void> {
    const courseTaken: CourseTaken = await this.courseTakenRepository.findByUserIdAndCourseId(
      userId,
      courseId,
    );
    if (!courseTaken) return;

    if (
      courseTaken.status !== CourseTakenStatusEnum.COMPLETED ||
      courseTaken.completion !== 100
    )
      return;

    const [
      sharedCourse,
    ] = await this.achievementRepository.getSharedCourseByCourseIdAndUserIdAndSocialMedia<
      Achievement<SharedCourseRule>
    >(courseId, userId, platform);
    if (sharedCourse) return;

    const badge = await this.badgeRepository.findByEventNameAndOrder(
      EventNameEnum.USER_REWARD_SHARE_COURSE,
      1,
    );

    await this.achievementRepository.save({
      ...sharedCourse,
      user: courseTaken.user,
      badge,
      rule: { courseId, platform },
      completed: true,
      eventName: EventNameEnum.USER_REWARD_SHARE_COURSE,
    });
  }

  private async rateAppReward({ userId, rate }: StartEventRateAppRuleDTO) {
    const response: User[] = await this.userRepository.find({
      where: { id: userId },
    });
    const user = response[0];
    if (!user) return;
    const badge = await this.badgeRepository.findByEventNameAndOrder(
      EventNameEnum.USER_REWARD_RATE_APP,
      1,
    );
    if (!badge) return;
    const achievement = await this.achievementRepository.findByUserIdAndBadgeId(
      user.id,
      badge.id,
    );
    if (achievement) return;
    await this.achievementRepository.save({
      ...achievement,
      badge,
      user,
      eventName: EventNameEnum.USER_REWARD_RATE_APP,
      completed: true,
      rule: { rate },
    });
  }

  private async inviteUserReward({
    inviteKey,
  }: InviteUserRewardData): Promise<void> {
    // 1 - Pegar usuário com essa inviteKey
    // 2 - Se tiver usuário com essa inviteKey, pegar a quantidade todos os usuários que foram convidados por esse usuário
    // 3 - Calcular quantos achievements o cara precisa ter baseado na quantidade de usuários que foram convidados por ele
    // e.g: o cara convidou 3 pessoas, então ele precisa ter 1 achievement
    // e.g: O cara convidou 4 pessoas, ele ainda vai ter 1 achievement
    // e.g: o cara convidou 6 pessoas, ele vai ter 2 achievements
    const userWithGivenInviteKey: User = await this.userRepository.findByInviteKey(
      inviteKey,
    );

    const usersInvitedCount: number = await this.userRepository.countUsersInvitedByUserId(
      userWithGivenInviteKey.id,
    );

    const neededAchievementsQuantity: number = Math.trunc(
      usersInvitedCount / 3,
    );

    if (neededAchievementsQuantity === 0) return;

    const inviteUsersBadge: Badge = await this.badgeRepository.findByEventNameAndOrder(
      EventNameEnum.USER_REWARD_INVITE_USER,
      1,
    );

    if (!inviteUsersBadge) return;

    const countInviteUserAchievements: number = await this.achievementRepository.countAchievementsByBadgeId(
      inviteUsersBadge.id,
    );

    if (neededAchievementsQuantity === countInviteUserAchievements) return;

    const achievementsDifference =
      neededAchievementsQuantity - countInviteUserAchievements;

    for (let counter = 0; counter < achievementsDifference; counter++) {
      await this.achievementRepository.save({
        badge: inviteUsersBadge,
        user: userWithGivenInviteKey,
        eventName: EventNameEnum.USER_REWARD_INVITE_USER,
        completed: true,
      });
    }
  }

  private async completeRegistrationReward({ id }) {
    const response: User[] = await this.userRepository.find({ where: { id } });
    const user = response[0];
    if (!user) return;
    const propertiesToCheck: string[] = [
      'address',
      'profession',
      'institutionName',
      'gender',
      'birthday',
      'nickname',
    ];
    let isProfileComplete = true;

    propertiesToCheck.forEach((propertyName: string) => {
      if (user[propertyName] == null) isProfileComplete = false;
    });

    if (!isProfileComplete) return;

    const completeRegistrationBadge: Badge = await this.badgeRepository.findByEventNameAndOrder(
      EventNameEnum.USER_REWARD_COMPLETE_REGISTRATION,
      1,
    );

    const achievement: Achievement = await this.achievementRepository.findCompletedByUserIdAndBadgeId(
      user.id,
      completeRegistrationBadge.id,
    );

    if (achievement) return;

    await this.achievementRepository.save({
      badge: completeRegistrationBadge,
      user,
      eventName: EventNameEnum.USER_REWARD_COMPLETE_REGISTRATION,
      completed: true,
    });
  }
}
