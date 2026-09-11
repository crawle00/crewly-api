import { Router } from "express"
import { ObjectId} from "mongodb"
import { z } from 'zod'
import { getDb } from "../db.js"
import { validate, notFound } from "../middleware/validate.js"

const router = Router()

const reportsSchema = z.object({
    listingId: z.string().refine((id) => ObjectId.isValid(id), 'invalid listing id'),
    reports: z.string().trim().min(1),
})


router.post('/' , validate({body: reportsSchema}), async (req , res, next) => {
    const {listingId , reports} = req.body
    const listing = getDb().collection('listings')

    if (!listing) {
        return res.status(404).json({error: 'listing not found'})
    }
    
    const newReport = {
        _id: new ObjectId(),
        userId: req.user._id,
        reports,
        createdAt: new Date()
    }

    const result = await listing.findOneAndUpdate(
        { _id: new ObjectId(listingId) },
        { $push: { reports: newReport } },
        { returnDocument: 'after' }
    )

    if(!result) {
        return next(notFound('listing not found'))
    }
    res.status(201).json(newReport)
})

router.get('/:listingId', async (req, res) => {
    const { listingId } = req.params

    const reports = await getDb().collection('reports')
        .aggregate([
            {
                $match: {
                    _id: new ObjectId(listingId)
                }
            },
            {
                $unwind: '$reports'
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'reports.userId',
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
                $project: {
                    _id: '$reports._id',
                    listingId: '$_id',
                    reports: '$reports.reports',
                    createdAt: '$reports.createdAt',
                    firstName: '$user.firstName',
                    lastName: '$user.lastName',
                    pfp: '$user.pfp'
                }
            },
            {
                $sort: {
                    createdAt: 1
                }
            }
        ])
        .toArray()

    res.json(reports)
})

export default router