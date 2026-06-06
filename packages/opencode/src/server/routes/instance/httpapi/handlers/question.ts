import { Question } from "@/question"
import { QuestionID } from "@/question/schema"
import { NamedError } from "@opencode-ai/core/util/error"
import { Bus } from "@/bus"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { Cause, Effect, Scope } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import { QuestionNotFoundError } from "../errors"
import { createQuestionReplyRecoveryPlan } from "./question-recovery"

export const questionHandlers = HttpApiBuilder.group(InstanceHttpApi, "question", (handlers) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const svc = yield* Question.Service
    const session = yield* Session.Service
    const promptSvc = yield* SessionPrompt.Service
    const scope = yield* Scope.Scope

    const list = Effect.fn("QuestionHttpApi.list")(function* () {
      return yield* svc.list()
    })

    const notFound = (requestID: QuestionID) =>
      new QuestionNotFoundError({
        requestID: String(requestID),
        message: `Question request not found: ${requestID}`,
      })

    const continueRecoveredReply = Effect.fn("QuestionHttpApi.continueRecoveredReply")(function* (
      sessionID: Question.Request["sessionID"],
    ) {
      yield* promptSvc.loop({ sessionID }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("question reply recovery failed").pipe(Effect.annotateLogs({ sessionID, cause }))
            yield* bus.publish(Session.Event.Error, {
              sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
          }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      )
    })

    const recoverReply = Effect.fn("QuestionHttpApi.recoverReply")(function* (ctx: {
      params: { requestID: QuestionID }
      payload: Question.Reply & { request?: Question.Request }
    }) {
      const request = ctx.payload.request
      if (!request || request.id !== ctx.params.requestID) {
        return yield* Effect.fail(notFound(ctx.params.requestID))
      }

      const messagesExit = yield* session.messages({ sessionID: request.sessionID }).pipe(Effect.exit)
      if (messagesExit._tag === "Failure") {
        return yield* Effect.fail(notFound(ctx.params.requestID))
      }
      const messages = messagesExit.value

      const plan = createQuestionReplyRecoveryPlan({
        messages,
        request,
        answers: ctx.payload.answers,
        now: Date.now(),
      })
      if (!plan) {
        return yield* Effect.fail(notFound(ctx.params.requestID))
      }

      yield* session.updateMessage(plan.message)
      yield* session.updatePart(plan.part)
      yield* bus.publish(Question.Event.Replied, {
        sessionID: plan.sessionID,
        requestID: plan.requestID,
        answers: plan.answers.map((answer) => [...answer]),
      })
      yield* continueRecoveredReply(plan.sessionID)
    })

    const reply = Effect.fn("QuestionHttpApi.reply")(function* (ctx: {
      params: { requestID: QuestionID }
      payload: Question.Reply & { request?: Question.Request }
    }) {
      yield* svc
        .reply({
          requestID: ctx.params.requestID,
          answers: ctx.payload.answers,
        })
        .pipe(
          Effect.catchTag("Question.NotFoundError", () => recoverReply(ctx)),
        )
      return true
    })

    const reject = Effect.fn("QuestionHttpApi.reject")(function* (ctx: { params: { requestID: QuestionID } }) {
      yield* svc.reject(ctx.params.requestID).pipe(
        Effect.catchTag("Question.NotFoundError", (error) =>
          Effect.fail(
            new QuestionNotFoundError({
              requestID: String(error.requestID),
              message: `Question request not found: ${error.requestID}`,
            }),
          ),
        ),
      )
      return true
    })

    return handlers.handle("list", list).handle("reply", reply).handle("reject", reject)
  }),
)
