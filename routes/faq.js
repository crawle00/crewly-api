import { Router } from "express"
import { ObjectId} from "mongodb"
import { z } from 'zod'
import { getDb } from "../db.js"
import { validate, notFound } from "../middleware/validate.js"

const router = Router()

const faqSchema = z.object({
    listingId: z.string().refine((id) => ObjectId.isValid(id), 'invalid listing id'),
    question: z.string().trim().min(1),
})

router.post('/' , validate({body: faqSchema}), async (req , res) => {
    const {listingId , question} = req.body
    const listing = await getDb().collection('listings').findOne({
        _id: new ObjectId(listingId)
    })

    if (!listing) {
        return res.status(404).json({error: 'listing not found'})
    }
    
    const newQuestion = {
        listingId: new ObjectId(listingId),
        userId: req.user._id,
        question,
        createdAt: new Date(),
        replies: []
    }

    newQuestion._id = (await getDb().collection('questions').insertOne(newQuestion)).insertedId
    res.status(201).json(newQuestion)
})

router.get('/:listingId' , async(req , res) => {
    const {listingId} = req.params

    const questions = await getDb().collection('questions')
        .aggregate([
            {
                $match: {
                    listingId: new ObjectId(listingId)
                }
            },
            {
                $sort: {
                    createdAt: 1
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: {
                    path: '$user',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $unwind: {
                    path: '$replies',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $sort: {
                    'replies.createdAt': 1
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'replies.userId',
                    foreignField: '_id',
                    as: 'replyUser'
                }
            },
            {
                $unwind: {
                    path: '$replyUser',
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $group: {
                    _id: '$_id',
                    listingId: {$first: '$listingId'},
                    question: {$first: '$question'},
                    createdAt: {$first: '$createdAt'},
                    firstName: {$first: '$user.firstName'},
                    lastName: {$first: '$user.lastName'},
                    pfp: {$first: '$user.pfp'},
                        replies: {
                            $push: {
                                $cond: [
                                    {$ne: ['$replies', null]},
                                    {
                                        _id: '$replies._id',
                                        reply: '$replies.reply',
                                        createdAt: '$replies.createdAt',
                                        firstName: '$replyUser.firstName',
                                        lastName: '$replyUser.lastName',
                                        pfp: '$replyUser.pfp',
                                        parentReplyId: '$replies.parentReplyId',
                                        questionId: '$_id' 
                                    },
                                    '$$REMOVE'
                                ]
                            }
                        }
                }
            }
        ]).toArray()

        if (!questions) {
            return res.status(404).json({error: 'questions not found'})
        }

        res.json(questions)
})

router.post('/:questionId/replies', async (req, res) => {

    console.log("🔥 REPLY ROUTE HIT")
    console.log("questionId:", req.params.questionId)
    console.log("body:", req.body)

    const { questionId } = req.params
    const { reply, parentReplyId } = req.body

    const questions = getDb().collection('questions')

    const question = await questions.findOne({
        _id: new ObjectId(questionId)
    })

    if (!question) {
        return res.status(404).json({
            error: 'question not found'
        })
    }

    const newReply = {
        _id: new ObjectId(),
        userId: req.user._id,
        reply,
        createdAt: new Date(),
        replies: []
    }

    // Reply directly to the question
    if (!parentReplyId) {

        const result = await questions.updateOne(
            { _id: new ObjectId(questionId) },
            {
                $push: {
                    replies: newReply
                }
            }
        )

        console.log("🔥 DIRECT REPLY UPDATE")
        console.log("matched:", result.matchedCount)
        console.log("modified:", result.modifiedCount)

        return res.status(201).json(newReply)
    }

    // Reply to another reply
    if (!ObjectId.isValid(parentReplyId)) {
        return res.status(400).json({
            error: 'invalid parent reply id'
        })
    }

    const findReplyPath = (replies, targetId, path = []) => {

        for (let i = 0; i < (replies || []).length; i++) {

            const item = replies[i]

            const currentPath = [...path, i]

            if (String(item._id) === String(targetId)) {
                return currentPath
            }

            const found = findReplyPath(
                item.replies,
                targetId,
                currentPath
            )

            if (found) {
                return found
            }
        }

        return null
    }

    const path = findReplyPath(
        question.replies,
        parentReplyId
    )

    if (!path) {
        return res.status(404).json({
            error: 'parent reply not found'
        })
    }

    const repliesPath =
        `replies.${path.join('.replies.')}.replies`

    console.log("🔥 NESTED REPLY PATH:", repliesPath)

    const result = await questions.updateOne(
        {
            _id: new ObjectId(questionId)
        },
        {
            $push: {
                [repliesPath]: newReply
            }
        }
    )

    console.log("🔥 NESTED REPLY UPDATE")
    console.log("matched:", result.matchedCount)
    console.log("modified:", result.modifiedCount)

    return res.status(201).json(newReply)
})

export default router