import { Router } from "express"
import { ObjectId} from "mongodb"
import { z } from 'zod'
import { getDb } from "../db.js"
import { validate } from "../middleware/validate.js"

const router = Router()

const faqSchema = z.object({
    listingId: z.string().refine((id) => ObjectId.isValid(id), 'invalid listing id'),
    question: z.string().trim().min(1),
})

const listingParamsSchema = z.object({
    listingId: z.string().refine((id) => ObjectId.isValid(id), 'invalid listing id')
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
        createdAt: new Date()
    }

    newQuestion._id = (await getDb().collection('questions').insertOne(newQuestion)).insertedId
    res.status(201).json(newQuestion)
})
router.get('/mine/questions', async (req, res) => {
    const questions = await getDb().collection('questions')
        .aggregate([
            { $match: { userId: req.user._id } },
            { $sort: { createdAt: -1 } },
            { $lookup: { from: 'replies', localField: '_id', foreignField: 'questionId', as: 'replies' } },
            { $lookup: { from: 'listings', localField: 'listingId', foreignField: '_id', as: 'listing' } },
            { $unwind: { path: '$listing', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1, listingId: 1, question: 1, createdAt: 1,
                    listingTitle: '$listing.title',
                    replyCount: { $size: '$replies' },
                    latestReplyAt: { $max: '$replies.createdAt' },
                },
            },
        ])
        .toArray()

    res.json(questions.filter((q) => q.replyCount > 0))
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
                $lookup: {
                    from: 'replies',
                    let: { questionId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $eq: ['$questionId', '$$questionId']
                                }
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
                            $project: {
                                _id: 1,
                                reply: 1,
                                createdAt: 1,
                                firstName: '$replyUser.firstName',
                                lastName: '$replyUser.lastName',
                                pfp: '$replyUser.pfp',
                                parentReplyId: 1,
                                questionId: 1
                            }
                        }
                    ], as: "replies"
                }
            },
            {
                $project: {
                    _id: 1,
                    listingId: 1,
                    question: 1,
                    createdAt: 1,
                    firstName: '$user.firstName',
                    lastName: '$user.lastName',
                    pfp: '$user.pfp',
                    replies: 1
                }
            }
        ]) .toArray()

        if (!questions) {
            return res.status(404).json({error: 'questions not found'})
        }

        res.json(questions)
})

router.post('/:questionId/replies', async (req, res) => {
    const { questionId } = req.params
    const { reply , parentReplyId } = req.body

    const question = await getDb().collection('questions').findOne({
        _id: new ObjectId(questionId)
    })

    if (!question) {
        return res.status(404).json({ error: 'question not found' })
    }

    let parentId = null

    if(parentReplyId) {
            if (!ObjectId.isValid(parentReplyId)) {
                return res.status(400).json({error: 'invalid parent reply id'})
            }

        const parentReply = await getDb().collection('replies').findOne({
            _id: new ObjectId(parentReplyId),
            questionId: new ObjectId(questionId)
        })

        if (!parentReply) {
            return res.status(404).json({error: 'parent reply not found'})
        }

        parentId = new ObjectId(parentReplyId)
    }

    const newReply = {
        questionId: new ObjectId(questionId),
        userId: req.user._id,
        reply,
        createdAt: new Date(),
        parentReplyId: parentId
    }

    newReply._id = (
        await getDb().collection('replies').insertOne(newReply)
    ).insertedId

    res.status(201).json(newReply)
})

export default router