import { mentionSegments } from "../utils/mentions.ts";

export function MemberMentions({text}: {text: string}) {
  return <>{mentionSegments(text).map((part, index) => part.member
    ? <span className="ub-mention" data-member={part.member} key={index}>{part.text}</span>
    : part.text)}</>;
}
