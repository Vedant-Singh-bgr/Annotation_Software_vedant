import { prisma } from "@/lib/db";
import { forbidden, notFound } from "@/lib/api";
import type { SessionUser } from "@/lib/auth";

/**
 * Load an assignment (with clip → batch → project) and authorize the user.
 * - ANNOTATOR: must own the assignment.
 * - ORG_ADMIN: assignment's project must belong to their org.
 * - PLATFORM_ADMIN: always allowed.
 */
export async function getAuthorizedAssignment(user: SessionUser, assignmentId: string) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      clip: { include: { batch: { include: { project: true } } } },
    },
  });
  if (!assignment) notFound("Assignment not found");

  const orgId = assignment.clip.batch.project.organizationId;
  // Explicit allowlist with a default DENY. This was a denylist — anything that
  // wasn't ANNOTATOR or ORG_ADMIN fell through to allow, which was correct only
  // because PLATFORM_ADMIN was the sole remaining role. Any role string added
  // later (a reviewer/QC tier, a stale value, a typo in a seed) would have
  // silently inherited platform-admin reach over every assignment in every
  // organisation. Twelve route handlers and two pages take their entire
  // authorization from this function, so the fall-through is now closed.
  switch (user.role) {
    case "PLATFORM_ADMIN":
      break; // unscoped by design
    case "ORG_ADMIN":
      if (orgId !== user.organizationId)
        forbidden("This task belongs to another organization.");
      break;
    case "ANNOTATOR":
      if (assignment.annotatorId !== user.id)
        forbidden("This task is not assigned to you.");
      break;
    default:
      forbidden("Not authorized for this assignment.");
  }
  return assignment;
}

/** Whether the user may edit annotation output on this assignment. */
export function canEditAnnotations(
  user: SessionUser,
  assignment: { annotatorId: string; status: string },
): boolean {
  if (user.role !== "ANNOTATOR") return false;
  if (assignment.annotatorId !== user.id) return false;
  return assignment.status !== "APPROVED"; // locked once approved
}

/** Load a task, authorize the user against its assignment, and require edit rights. */
export async function getEditableTask(user: SessionUser, taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) notFound("Task not found");
  const assignment = await getAuthorizedAssignment(user, task.assignmentId);
  if (!canEditAnnotations(user, assignment)) {
    forbidden("You cannot edit this task.");
  }
  return { task, assignment };
}

/** Load a sub-task (with its parent task), authorize, and require edit rights. */
export async function getEditableSubTask(user: SessionUser, subTaskId: string) {
  const subTask = await prisma.subTask.findUnique({
    where: { id: subTaskId },
    include: { task: true },
  });
  if (!subTask) notFound("Sub-task not found");
  const assignment = await getAuthorizedAssignment(user, subTask.task.assignmentId);
  if (!canEditAnnotations(user, assignment)) {
    forbidden("You cannot edit this sub-task.");
  }
  return { subTask, assignment };
}
