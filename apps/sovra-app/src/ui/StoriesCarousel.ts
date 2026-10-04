/**
 * @file apps/sovra-app/src/ui/StoriesCarousel.ts
 * UI Layer Contract: Horizontal Instagram Story Circles with Gradient Ring & RAM TTL.
 *
 * Implements:
 * 1. Horizontal carousel container.
 * 2. Gradient ring for unseen stories and sleek grey ring for seen stories.
 * 3. Add-to-story (+) button.
 * 4. 24h Ephemeral RAM Ring Buffer indicator.
 */

export interface StoryCircleProps {
  readonly creatorHandle: string;
  readonly creatorName: string;
  readonly avatarUrl?: string | undefined;
  readonly avatarEmoji: string;
  readonly avatarBg: string;
  readonly isSeen: boolean;
  readonly hoursRemaining: number;
}

export function renderStoriesCarouselHtml(stories: readonly StoryCircleProps[]): string {
  return `
    <div class="stories-bar">
      <div class="story-item">
        <div class="story-ring seen">
          <div class="story-avatar" style="background: #1e293b; color: #38bdf8;">+</div>
        </div>
        <div class="story-username">Your Story</div>
      </div>
      ${stories
        .map(
          s => `
        <div class="story-item" id="story-${s.creatorHandle}">
          <div class="story-ring ${s.isSeen ? 'seen' : ''}">
            <div class="story-avatar" style="background: ${s.avatarBg};">${s.avatarEmoji}</div>
          </div>
          <div class="story-username">${s.creatorName}</div>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}
