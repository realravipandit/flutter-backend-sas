const express = require('express');
const router = express.Router();
const itemController = require('../controllers/itemController');

router.get('/next-code', itemController.getNextItemCode);
router.get('/search', itemController.searchItemNames);
router.get('/', itemController.getItems);
router.post('/', itemController.createItem);
router.get('/units', itemController.getUnits);
router.get('/groups', itemController.getItemGroups);
router.get('/subgroups/:groupId', itemController.getItemSubGroups);

module.exports = router;