import { Question } from "@/question"
import { MessageV2 } from "@/session/message-v2"

export type QuestionReplyRecoveryPlan = {
  sessionID: Question.Request["sessionID"]
  message: MessageV2.Assistant
  part: MessageV2.ToolPart
  answers: ReadonlyArray<Question.Answer>
  requestID: Question.Request["id"]
}

function isRealUserMessage(message: MessageV2.WithParts) {
  if (message.info.role !== "user") return false
  return message.parts.some((part) => !("synthetic" in part) || part.synthetic !== true)
}

function findQuestionPart(
  message: MessageV2.WithParts,
  request: Question.Request,
): MessageV2.ToolPart | undefined {
  const tool = request.tool
  if (!tool) return

  return message.parts.find(
    (part): part is MessageV2.ToolPart =>
      part.type === "tool" && part.tool === "question" && part.callID === tool.callID,
  )
}

function formatAnsweredQuestions(request: Question.Request, answers: ReadonlyArray<Question.Answer>) {
  const formatted = request.questions
    .map((question, index) => `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`)
    .join(", ")

  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}

function questionTitle(request: Question.Request) {
  return `Asked ${request.questions.length} question${request.questions.length > 1 ? "s" : ""}`
}

export function createQuestionReplyRecoveryPlan(input: {
  messages: ReadonlyArray<MessageV2.WithParts>
  request: Question.Request
  answers: ReadonlyArray<Question.Answer>
  now: number
}): QuestionReplyRecoveryPlan | undefined {
  const tool = input.request.tool
  if (!tool) return

  const messageIndex = input.messages.findIndex(
    (message) => message.info.role === "assistant" && message.info.id === tool.messageID,
  )
  if (messageIndex === -1) return

  const message = input.messages[messageIndex]
  if (!message || message.info.role !== "assistant") return

  if (input.messages.slice(messageIndex + 1).some(isRealUserMessage)) {
    return
  }

  const part = findQuestionPart(message, input.request)
  if (!part || part.state.status !== "running") return

  return {
    sessionID: input.request.sessionID,
    requestID: input.request.id,
    answers: input.answers,
    message: {
      ...message.info,
      finish: message.info.finish ?? "tool-calls",
      time: {
        ...message.info.time,
        completed: message.info.time.completed ?? input.now,
      },
    },
    part: {
      ...part,
      state: {
        status: "completed",
        input: part.state.input,
        output: formatAnsweredQuestions(input.request, input.answers),
        title: questionTitle(input.request),
        metadata: {
          answers: input.answers.map((answer) => [...answer]),
        },
        time: {
          start: part.state.time.start,
          end: input.now,
        },
      },
    },
  }
}
