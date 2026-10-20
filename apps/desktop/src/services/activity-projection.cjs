/**
 * @file activity-projection.cjs
 * @description Renders verified domain events into concise Activity Feed entries.
 * Avoids echoing full raw chat transcripts into group chat (UB-V4-U01-004, U10-004).
 */

class ActivityProjectionService {
  constructor(storageService) {
    this.storage = storageService;
  }

  /**
   * Summarizes an event for the group activity view.
   */
  projectEventSummary(kind, actor, payload = {}) {
    const actorName = actor.provider.toUpperCase();
    switch (kind) {
      case 'GOAL_CREATED':
        return `${actorName} khởi tạo mục tiêu mới: "${payload.title || 'Không tiêu đề'}".`;
      case 'BRIEF_READY':
        return `${actorName} (BA) đã hoàn tất Discovery Brief. [Xem chi tiết]`;
      case 'PLAN_APPROVED':
        return `PO đã phê duyệt Kế hoạch hành động Revision ${payload.revision || 1}.`;
      case 'TASK_ASSIGNED':
        return `Nhiệm vụ "${payload.taskTitle || ''}" đã được giao cho ${payload.assignee || 'Agent'}.`;
      case 'COMMIT_READY':
        return `${actorName} đã chuẩn bị commit ${payload.commitSha ? payload.commitSha.slice(0, 7) : ''} trên nhánh ${payload.branch || ''}.`;
      case 'PUSH_APPROVAL_REQUESTED':
        return `Yêu cầu quyền Push lên nhánh ${payload.branch || ''} cho commit ${payload.commitSha ? payload.commitSha.slice(0, 7) : ''}.`;
      case 'PUSHED':
        return `Đã push thành công lên GitHub (${payload.commitSha ? payload.commitSha.slice(0, 7) : ''}).`;
      case 'REVIEW_RECEIVED':
        return `${actorName} đã gửi phản biện mã nguồn: ${payload.blockerCount ? payload.blockerCount + ' blocker' : 'Đạt chuẩn'}.`;
      case 'BUG_OPENED':
        return `Phát hiện lỗi [${payload.severity || 'SEV2'}]: ${payload.description || ''}.`;
      case 'FIX_READY':
        return `${actorName} đã hoàn thành bản sửa lỗi cho [${payload.bugId || ''}].`;
      case 'QA_PASSED':
        return `Codex (QA) xác nhận kiểm thử đạt chuẩn cho Milestone ${payload.milestoneOrder || ''}.`;
      case 'MILESTONE_COMPLETE':
        return `Hoàn thành Milestone ${payload.milestoneOrder || ''}: "${payload.title || ''}".`;
      case 'GOAL_COMPLETE':
        return `Mục tiêu "${payload.title || ''}" đã hoàn thành và nghiệm thu toàn vẹn.`;
      case 'BLOCKED':
        return `Tiến trình tạm dừng: ${payload.reason || 'Cần can thiệp'}.`;
      case 'WAITING_USER':
        return `Đang chờ phản hồi xác nhận từ người dùng.`;
      default:
        return `Hoạt động mới từ ${actorName}.`;
    }
  }
}

module.exports = {
  ActivityProjectionService,
};
