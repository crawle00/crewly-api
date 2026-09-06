import { Router } from "express"
import { ObjectId} from "mongodb"
import { z } from 'zod'
import { getDb } from "../db"
import { validate } from "../middleware/validate"

const router = Router()

const faqSchema = z.object({
    listingId: z.string().refine((id) => ObjectId.isValid(id), 'invalid listing id'),
    question: z.string().trim().min(1),
})

const listingParamsSchema = z.object({
    listingId: z.string().refine((id) => ObjectId.isValid(id), 'invalid listing id')
})

router.post('/' , validate({body: faqSchema}), validate({params: listingParamsSchema}), async (req , res) => {
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

router.get('/:listingId' , async(req , res) => {
    const {listingId} = req.params

    const questions = await getDb().collection('questions')
        .find({listingId: new ObjectId(listingId)})
        .sort({createdAt: 1})
        .toArray()

        res.json(questions)
})

export default router